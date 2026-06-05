#!/usr/bin/env node
/**
 * Vantyx email-enrich — find a contact email for a lead by crawling its website.
 *
 * gmaps-scrape gives phone, rarely email. This crawls the lead's site (homepage +
 * common contact pages), extracts mailto:/plain-text emails, filters junk, and
 * picks the best one — preferring domain-matching role accounts. With --write it
 * stores the email on the lead ONLY if the lead currently has none (never clobbers).
 *
 * Usage:
 *   node run.mjs --lead-id <id> [--write] [--leads-db <path>] [--json]
 *   node run.mjs --url https://example.com [--json]
 *
 * Exit codes: 0 found · 2 none found · 1 CLI/IO error
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB = "/home/paperclip/vantyx-leads.sqlite";
const ROLE = ["info", "office", "contact", "sales", "service", "estimates", "estimating",
  "scheduling", "schedule", "hello", "support", "admin", "dispatch", "team", "shop"];
const PATHS = ["", "/contact", "/contact-us", "/contact.html", "/about", "/about-us", "/get-a-quote", "/request-service"];
const BAD_DOMAIN = /(sentry|wix|wixpress|squarespace|godaddy|shopify|cloudflare|google|gstatic|googleapis|schema\.org|w3\.org|example\.(com|org)|email\.png|domain\.com|yourcompany|sentry\.io|2x|js?delivr|jquery)/i;
const BAD_LOCAL = /(your|name|email|user|someone|firstname|lastname|test|noreply|no-reply|donotreply)$/i;
const FILE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mp4|pdf|woff2?)$/i;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2), n = argv[i + 1];
    if (!n || n.startsWith("--")) a[k] = true; else { a[k] = n; i++; }
  }
  return a;
}
function die(c, m) { console.error(`email-enrich: ${m}`); process.exit(c); }
function normUrl(u) {
  let s = String(u || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { return new URL(s).origin; } catch { return ""; }
}
function rootDomain(host) {
  const p = String(host || "").toLowerCase().replace(/^www\./, "").split(".");
  return p.length >= 2 ? p.slice(-2).join(".") : host;
}

async function fetchText(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal, redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; VantyxBot/1.0; +https://usevantyx.com)" },
    });
    if (!r.ok) return "";
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return "";
    return await r.text();
  } catch { return ""; }
  finally { clearTimeout(t); }
}

function harvest(html) {
  const out = new Set();
  // mailto: links (most reliable) — tag with priority
  const mail = [...html.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) => decodeURIComponent(m[1]).toLowerCase());
  const text = [...html.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase());
  for (const e of mail) out.add("M|" + e);
  for (const e of text) out.add("T|" + e);
  return [...out];
}

function clean(tagged) {
  const seen = new Map(); // email -> {mailto:bool}
  for (const t of tagged) {
    const [src, email] = [t[0], t.slice(2)];
    if (FILE_EXT.test(email)) continue;
    const [local, domain] = email.split("@");
    if (!local || !domain) continue;
    if (BAD_DOMAIN.test(domain) || BAD_DOMAIN.test(email)) continue;
    if (BAD_LOCAL.test(local)) continue;
    if (domain.split(".").pop().length < 2) continue;
    const cur = seen.get(email) || { mailto: false };
    if (src === "M") cur.mailto = true;
    seen.set(email, cur);
  }
  return seen;
}

function score(email, mailto, siteDomain) {
  const [local, domain] = email.split("@");
  let s = 0;
  if (rootDomain(domain) === siteDomain) s += 100; // matches the business domain
  if (ROLE.includes(local)) s += 30;
  if (mailto) s += 20;
  if (/(gmail|yahoo|hotmail|aol|outlook|icloud)\.com$/i.test(domain)) s -= 10; // personal free mail = weaker but ok
  return s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let leadId = args["lead-id"], website = args.url, db = null;
  const dbPath = args["leads-db"] || DEFAULT_DB;

  if (leadId) {
    if (!existsSync(dbPath)) die(1, `leads-db not found: ${dbPath}`);
    db = new DatabaseSync(dbPath);
    const row = db.prepare("SELECT id, name, website, email FROM leads WHERE id = ?").get(leadId);
    if (!row) die(2, `lead not found: ${leadId}`);
    if (row.email && String(row.email).trim()) {
      console.log(JSON.stringify({ lead_id: leadId, already_has_email: row.email, wrote: false }));
      process.exit(0);
    }
    website = row.website;
  }
  const origin = normUrl(website);
  if (!origin) { console.log(JSON.stringify({ lead_id: leadId || null, website: website || null, best_email: null, reason: "no-website", wrote: false })); process.exit(2); }
  const siteDomain = rootDomain(new URL(origin).hostname);

  const tagged = [];
  for (const p of PATHS) {
    const html = await fetchText(origin + p);
    if (html) tagged.push(...harvest(html));
    // small early-exit: if we already have a strong domain-match mailto, stop early
  }
  const cleaned = clean(tagged);
  const ranked = [...cleaned.entries()]
    .map(([email, meta]) => ({ email, mailto: meta.mailto, score: score(email, meta.mailto, siteDomain) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0] || null;
  let wrote = false;
  if (best && args.write && leadId && db) {
    db.prepare("UPDATE leads SET email = ? WHERE id = ? AND (email IS NULL OR email = '')").run(best.email, leadId);
    wrote = true;
  }
  if (db) db.close();

  const result = {
    lead_id: leadId || null, website: origin, site_domain: siteDomain,
    best_email: best ? best.email : null,
    candidates: ranked.slice(0, 6),
    wrote,
  };
  console.log(JSON.stringify(result, null, args.json ? 2 : 0));
  process.exit(best ? 0 : 2);
}
main();
