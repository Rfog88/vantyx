#!/usr/bin/env node
/**
 * Vantyx demo-smoke-check — light "is this demo live?" pre-filter.
 *
 * NOT the quality gate (Ryan's approval in the morning review is). This only
 * makes sure a freshly deployed demo is actually reachable and public before it
 * is posted to Discord for Board review — so Ryan never clicks a dead link or a
 * Vercel auth wall. It replaces the retired vantyx-web-os-specific
 * `brand-consistency-check`.
 *
 * Inputs (CLI flags OR a JSON object on stdin):
 *   --preview-url <url>   required; the canonical *.vercel.app demo URL
 *   --lead-name <name>    optional; used for the has_name informational check
 *   --phone <phone>       optional; used for the has_phone informational check
 *
 * Output (stdout JSON):
 *   { passes, url, status, checks: { http_200, public, has_tel, has_phone,
 *     has_name }, findings: [...] }
 *
 * Exit codes:
 *   0  — passes (HTTP 200 and not behind an auth/protection wall)
 *   2  — does not pass (dead link, non-200, or protection still enabled)
 *   3  — fetch/network error
 *   1  — CLI error (missing --preview-url)
 *
 * Note (SPA caveat): Lovable ships a client-rendered Vite/React app, so the
 * raw HTML of `index.html` may not contain the phone/name text even when the
 * rendered page does. `has_tel`/`has_phone`/`has_name` are therefore
 * INFORMATIONAL only; `passes` depends solely on reachability + public access.
 */

import { readFileSync } from "node:fs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

function readStdinJson() {
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const PROTECTION_RE = /(authentication required|vercel.*(sso|authentication)|password protection|deployment is protected|log in to vercel)/i;

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const stdin = process.stdin.isTTY ? {} : readStdinJson();

  const url = cli["preview-url"] || stdin.preview_url || stdin.previewUrl;
  const leadName = cli["lead-name"] || stdin.lead_name || stdin.leadName || "";
  const phone = cli.phone || stdin.phone || "";

  if (!url || typeof url !== "string") {
    console.error(JSON.stringify({ error: "decision-needed", reason: "missing --preview-url" }));
    process.exit(1);
  }

  const findings = [];
  let status = null;
  let html = "";
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "VantyxSmokeBot/1.0" },
    });
    status = res.status;
    html = await res.text();
  } catch (e) {
    console.log(JSON.stringify({
      passes: false,
      url,
      status: null,
      checks: { http_200: false, public: false, has_tel: false, has_phone: false, has_name: false },
      findings: [`fetch failed: ${e.message}`],
    }));
    process.exitCode = 3;
    return;
  }

  const http_200 = status === 200;
  if (!http_200) findings.push(`HTTP status ${status} (expected 200)`);

  const protectedWall = (status === 401 || status === 403) || PROTECTION_RE.test(html);
  const isPublic = http_200 && !protectedWall;
  if (protectedWall) findings.push("demo appears to be behind a Vercel auth/protection wall — protection-disable may have failed");

  // Informational signals (unreliable on a client-rendered SPA — see header note).
  const has_tel = /href=["']tel:/i.test(html);
  const phoneDigits = String(phone).replace(/\D/g, "").slice(-7);
  const has_phone = phoneDigits.length === 7 && html.replace(/\D/g, "").includes(phoneDigits);
  const nameToken = String(leadName).trim().split(/\s+/)[0] || "";
  const has_name = nameToken.length >= 3 && html.toLowerCase().includes(nameToken.toLowerCase());

  if (!has_tel) findings.push("no tel: link in static HTML (expected on a client-rendered SPA — informational)");

  const passes = isPublic;

  console.log(JSON.stringify({
    passes,
    url,
    status,
    checks: { http_200, public: isPublic, has_tel, has_phone, has_name },
    findings,
  }, null, 2));

  // Use exitCode (not process.exit) so we don't trip a libuv teardown assertion
  // on an open keep-alive socket; the event loop drains and exits with this code.
  process.exitCode = passes ? 0 : 2;
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
