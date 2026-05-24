#!/usr/bin/env node
// lead-update — UPDATE a single row in the leads SQLite table.
//
// Invocation:
//   node skills/lead-update/run.mjs --lead-id <uuid> [--stage demo_built] [--demo-url https://...] [--score 78]

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

  if (sets.length === 0) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "no update fields provided" }));
    process.exit(2);
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
