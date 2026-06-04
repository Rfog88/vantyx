#!/usr/bin/env node
// lead-update — UPDATE a single row in the leads SQLite table.
//
// Invocation:
//   node skills/lead-update/run.mjs --lead-id <uuid> [--stage demo_built] [--demo-url https://...] [--score 78]
//   node skills/lead-update/run.mjs --lead-id <uuid> --review-posted   # stamp review_posted_at = now
//   node skills/lead-update/run.mjs --lead-id <uuid> --board-approved  # stamp board_approved_at = now

import { parseArgs } from "node:util";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  console.error(JSON.stringify({
    error: "adapter-broken",
    reason: "node_sqlite_unavailable",
    detail: "Bind NODE_OPTIONS=--experimental-sqlite at project or agent env level.",
    message: e.message,
  }));
  process.exit(3);
}

const ALLOWED_STAGES = new Set([
  "new", "demo_built", "outreach_sent", "replied", "booked", "won", "lost",
]);

function openDb() {
  const path = process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite";
  return new DatabaseSync(path);
}

async function main() {
  const { values } = parseArgs({
    options: {
      "lead-id": { type: "string" },
      stage: { type: "string" },
      "demo-url": { type: "string" },
      score: { type: "string" },
      "review-posted": { type: "boolean" },
      "board-approved": { type: "boolean" },
    },
  });

  const leadId = values["lead-id"];
  if (!leadId) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "missing lead-id" }));
    process.exit(2);
  }

  const sets = [];
  const params = [];
  const fieldsSet = [];

  if (values.stage) {
    if (!ALLOWED_STAGES.has(values.stage)) {
      console.error(JSON.stringify({
        error: "decision-needed",
        reason: "invalid stage",
        got: values.stage,
        allowed: [...ALLOWED_STAGES],
      }));
      process.exit(2);
    }
    sets.push("stage = ?");
    params.push(values.stage);
    fieldsSet.push("stage");
    if (values.stage === "outreach_sent") {
      sets.push("outreach_sent_at = datetime('now')");
      fieldsSet.push("outreach_sent_at");
    }
  }

  if (values["demo-url"]) {
    sets.push("demo_url = ?");
    params.push(values["demo-url"]);
    fieldsSet.push("demo_url");
  }

  if (values.score) {
    const s = parseInt(values.score, 10);
    if (Number.isNaN(s) || s < 0 || s > 100) {
      console.error(JSON.stringify({ error: "decision-needed", reason: "invalid score (must be 0-100)" }));
      process.exit(2);
    }
    sets.push("score = ?");
    params.push(s);
    fieldsSet.push("score");
  }

  if (values["review-posted"]) {
    sets.push("review_posted_at = datetime('now')");
    fieldsSet.push("review_posted_at");
  }

  if (values["board-approved"]) {
    sets.push("board_approved_at = datetime('now')");
    fieldsSet.push("board_approved_at");
  }

  if (sets.length === 0) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "no update fields provided" }));
    process.exit(2);
  }

  // Terminal-stage guard: refuse to downgrade a shipped lead back to demo_built.
  // Protects against cross-day re-runs re-processing outreach_sent leads (VAN-394).
  const TERMINAL_STAGES = new Set(["outreach_sent", "outreach_failed", "replied", "booked", "won", "lost"]);
  if (values.stage === "demo_built" || values.stage === "new") {
    const db = openDb();
    const currentRow = db.prepare("SELECT stage FROM leads WHERE id = ?").get(leadId);
    db.close();
    if (currentRow && TERMINAL_STAGES.has(String(currentRow.stage || "").trim().toLowerCase())) {
      console.error(JSON.stringify({
        error: "terminal-stage-guard",
        current_stage: currentRow.stage,
        attempted_stage: values.stage,
        lead_id: leadId,
        message: "Refusing to downgrade terminal stage — lead already shipped.",
      }));
      process.exit(2);
    }
  }

  sets.push("updated_at = datetime('now')");
  params.push(leadId);

  const db = openDb();
  const result = db.prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  db.close();

  if (result.changes === 0) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "lead-id not found", leadId }));
    process.exit(2);
  }

  console.log(JSON.stringify({ updated: true, lead_id: leadId, fields_set: fieldsSet }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
