#!/usr/bin/env node
// suppression-check — is this address on the do-not-contact list? READ-ONLY.
//
// The GLOBAL RULE (VANTYX-OUTREACH-SEQUENCE.md): "Check suppression list first"
// before EVERY send (cold, drip, or YES auto-reply). An address is suppressed if
// there is an exact email-scope row OR a domain-scope row matching its domain.
//
// Invocation:
//   node run.mjs --email info@acme.com           # -> {"suppressed":true/false,...}
//   node run.mjs --email info@acme.com --quiet    # exit 10 if suppressed, 0 if clear (for shell gating)
//
// Exit: 0 clear (or printed result) · 10 suppressed (only with --quiet) · 2 bad input · 3 adapter-broken

import { parseArgs } from "node:util";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  console.error(JSON.stringify({ error: "adapter-broken", reason: "node_sqlite_unavailable",
    detail: "Bind NODE_OPTIONS=--experimental-sqlite.", message: e.message }));
  process.exit(3);
}

function normEmail(s) { return String(s || "").trim().toLowerCase().replace(/^<|>$/g, ""); }
function domainOf(email) { const m = normEmail(email).match(/@(.+)$/); return m ? m[1] : ""; }

// Shared logic — keep in sync with suppression-add / classify-outreach-reply.
export function checkSuppressed(db, email) {
  const e = normEmail(email);
  const d = domainOf(e);
  const row = db.prepare(
    `SELECT value, scope, reason, created_at FROM suppressions
     WHERE (scope='email' AND value=?) OR (scope='domain' AND value=?)
     ORDER BY (scope='email') DESC LIMIT 1`
  ).get(e, d);
  return row
    ? { suppressed: true, email: e, matched_scope: row.scope, matched_value: row.value, reason: row.reason, since: row.created_at }
    : { suppressed: false, email: e };
}

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, quiet: { type: "boolean" } } });
  const email = values.email;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail(email))) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "valid --email required", got: email }));
    process.exit(2);
  }
  const db = new DatabaseSync(process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite", { readOnly: true });
  const res = checkSuppressed(db, email);
  db.close();
  if (values.quiet) { process.exit(res.suppressed ? 10 : 0); }
  console.log(JSON.stringify(res));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("run.mjs")) {
  main().catch((e) => { console.error(JSON.stringify({ error: "unknown-failure", message: e.message })); process.exit(1); });
}
