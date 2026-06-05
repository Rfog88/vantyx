#!/usr/bin/env node
// suppression-add — add an address (or whole domain) to the durable do-not-contact list.
//
// Idempotent: re-adding the same (value, scope) keeps the ORIGINAL reason/lead/source
// (the first suppression is canonical) and just bumps updated_at. Reputation-critical:
// once on the list, a lead can never be emailed again — see suppression-check / the
// send-path GLOBAL RULE in VANTYX-OUTREACH-SEQUENCE.md.
//
// Invocation:
//   node run.mjs --email info@acme.com --reason unsubscribe [--lead-id <id>] [--message-id <id>] [--notes "..."]
//   node run.mjs --domain acme.com    --reason complaint   [--lead-id <id>] [--notes "domain-wide"]
//
// Reasons: unsubscribe | hard_bounce | complaint | no_interest | manual
// Exit: 0 ok · 2 decision-needed (bad input) · 3 adapter-broken (no node:sqlite)

import { parseArgs } from "node:util";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  console.error(JSON.stringify({ error: "adapter-broken", reason: "node_sqlite_unavailable",
    detail: "Bind NODE_OPTIONS=--experimental-sqlite.", message: e.message }));
  process.exit(3);
}

const ALLOWED_REASONS = new Set(["unsubscribe", "hard_bounce", "complaint", "no_interest", "manual"]);

function normEmail(s) { return String(s || "").trim().toLowerCase().replace(/^<|>$/g, ""); }
function domainOf(email) { const m = normEmail(email).match(/@(.+)$/); return m ? m[1] : ""; }

function openDb() {
  return new DatabaseSync(process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite");
}

// Shared with classify-outreach-reply / suppression-check (kept inline so each skill is
// self-contained and has no cross-skill deploy dependency — keep these three in sync).
export function upsertSuppression(db, { value, scope, reason, leadId, messageId, notes }) {
  const v = scope === "domain" ? String(value).trim().toLowerCase() : normEmail(value);
  if (!v) return { ok: false, error: "empty value" };
  const existing = db.prepare("SELECT id FROM suppressions WHERE value=? AND scope=?").get(v, scope);
  if (existing) {
    db.prepare("UPDATE suppressions SET updated_at=datetime('now') WHERE id=?").run(existing.id);
    return { ok: true, created: false, id: existing.id, value: v, scope };
  }
  const r = db.prepare(
    `INSERT INTO suppressions (value, scope, reason, lead_id, source_message_id, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(v, scope, reason, leadId || null, messageId || null, notes || null);
  return { ok: true, created: true, id: r.lastInsertRowid, value: v, scope };
}

async function main() {
  const { values } = parseArgs({ options: {
    email: { type: "string" }, domain: { type: "string" }, reason: { type: "string" },
    "lead-id": { type: "string" }, "message-id": { type: "string" }, notes: { type: "string" },
  } });

  const reason = values.reason;
  if (!reason || !ALLOWED_REASONS.has(reason)) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "invalid or missing --reason",
      allowed: [...ALLOWED_REASONS] }));
    process.exit(2);
  }
  let scope, value;
  if (values.email) { scope = "email"; value = values.email; }
  else if (values.domain) { scope = "domain"; value = values.domain; }
  else { console.error(JSON.stringify({ error: "decision-needed", reason: "provide --email or --domain" })); process.exit(2); }

  if (scope === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail(value))) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "not a valid email", got: value }));
    process.exit(2);
  }

  const db = openDb();
  const res = upsertSuppression(db, {
    value, scope, reason, leadId: values["lead-id"], messageId: values["message-id"], notes: values.notes,
  });
  db.close();
  console.log(JSON.stringify({ suppressed: true, ...res, reason }));
}

// Only run as CLI when invoked directly (allows `import { upsertSuppression }` from tests).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("run.mjs")) {
  main().catch((e) => { console.error(JSON.stringify({ error: "unknown-failure", message: e.message })); process.exit(1); });
}
