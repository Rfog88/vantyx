#!/usr/bin/env node
/**
 * pending-approved-outreach — list demos that the Board APPROVED but haven't been
 * emailed yet, so the outreach-on-approval routine can send them. Read-only.
 *
 * Selection: Board approvals with status=approved whose payload.leadId points to a
 * lead still at stage='demo_built' (not yet sent/closed) AND that has an email.
 * Idempotent: once sent the lead -> outreach_sent and drops out next run.
 * Warm-up cap via --limit (default 10).
 *
 * Usage: node run.mjs [--limit N] [--json]
 * Exit: 0 (always; empty list is normal)
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const BASE = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
const CID = process.env.VANTYX_COMPANY_ID || "a59f9f5f-a472-4612-909b-c20d07099cd9";
const DB = process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite";
const SUPPRESSED_STAGES = new Set(["closed_no_interest", "closed_unsubscribed", "lost", "outreach_sent", "replied", "booked", "won"]);

function args(a) { const o = {}; for (let i = 0; i < a.length; i++) { if (!a[i].startsWith("--")) continue; const k = a[i].slice(2), n = a[i + 1]; if (!n || n.startsWith("--")) o[k] = true; else { o[k] = n; i++; } } return o; }

// GLOBAL RULE (VANTYX-OUTREACH-SEQUENCE.md): check the suppression list before EVERY send.
// Protects against re-scraped duplicates of a lead that already unsubscribed/bounced/etc.
function normEmail(s) { return String(s || "").trim().toLowerCase().replace(/^<|>$/g, ""); }
function isSuppressed(db, email) {
  const e = normEmail(email); const m = e.match(/@(.+)$/); const d = m ? m[1] : "";
  return db.prepare(
    "SELECT reason FROM suppressions WHERE (scope='email' AND value=?) OR (scope='domain' AND value=?) LIMIT 1"
  ).get(e, d) || null;
}

async function api(path) {
  const r = await fetch(BASE + path, { headers: { "content-type": "application/json" } });
  const t = await r.text();
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return t ? JSON.parse(t) : [];
}
function list(d) { return Array.isArray(d) ? d : (d.approvals || d.data || []); }

async function main() {
  const a = args(process.argv.slice(2));
  const limit = parseInt(a.limit || process.env.OUTREACH_DAILY_CAP || "10", 10);
  if (!existsSync(DB)) { console.log(JSON.stringify({ count: 0, leads: [], error: "no-db" })); process.exit(0); }
  const db = new DatabaseSync(DB, { readOnly: true });
  const getLead = db.prepare("SELECT id,name,niche,city,state,email,demo_url,stage FROM leads WHERE id=?");

  let approvals = [];
  try { approvals = list(await api(`/api/companies/${CID}/approvals?status=approved`)); }
  catch (e) { db.close(); console.log(JSON.stringify({ count: 0, leads: [], error: e.message })); process.exit(0); }

  const out = [];
  const seen = new Set();
  for (const ap of approvals) {
    const payload = ap.payload || {};
    const leadId = payload.leadId;
    if (!leadId || seen.has(leadId)) continue;
    const lead = getLead.get(leadId);
    if (!lead) continue;
    if (lead.stage !== "demo_built") continue;          // already sent/closed => skip (idempotent)
    if (SUPPRESSED_STAGES.has(lead.stage)) continue;
    if (!lead.email || !String(lead.email).trim()) continue; // not emailable
    try { const sup = isSuppressed(db, lead.email); if (sup) { seen.add(leadId); continue; } } // do-not-contact
    catch { /* suppressions table absent (pre-0005) — fail open to legacy behavior */ }
    seen.add(leadId);
    // the approvals-list endpoint omits linked issues; fetch them so the routine can close them
    let issueIds = ap.issueIds || (ap.issues || []).map((i) => i.id || i);
    if (!issueIds || !issueIds.length) {
      try {
        const r = await api(`/api/approvals/${ap.id}/issues`);
        const arr = Array.isArray(r) ? r : (r.issues || r.data || []);
        issueIds = arr.map((i) => i.id || i).filter(Boolean);
      } catch { issueIds = []; }
    }
    out.push({
      leadId: lead.id, name: lead.name, niche: lead.niche, city: lead.city, state: lead.state,
      email: lead.email, demoUrl: lead.demo_url || payload.demoUrl,
      approvalId: ap.id, issueIds,
    });
    if (out.length >= limit) break;
  }
  db.close();
  console.log(JSON.stringify({ count: out.length, cap: limit, leads: out }, null, a.json ? 2 : 0));
}
main().catch((e) => { console.log(JSON.stringify({ count: 0, leads: [], error: e.message })); process.exit(0); });
