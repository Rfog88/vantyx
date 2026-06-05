#!/usr/bin/env node
/**
 * board-approval-create — deterministically create a Board approval ("Approve demo: X")
 * for a lead, so it ALWAYS shows an approve button in the Paperclip inbox.
 *
 * Replaces the nondeterministic escalate-to-board path in morning-demo-review.
 * Creates (a) an "Approve demo: <name>" issue and (b) a request_board_approval linked
 * to it, with payload.leadId so the auto-send step (pending-approved-outreach) can find it.
 *
 * Usage: node run.mjs --lead-id <id> [--agent-id <uuid>] [--json]
 * Exit: 0 created · 2 lead/data problem · 1 IO/API error
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const BASE = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
const CID = process.env.VANTYX_COMPANY_ID || "a59f9f5f-a472-4612-909b-c20d07099cd9";
const DEFAULT_AGENT = process.env.VANTYX_CMO_ID || "9b08537a-3620-427d-9639-5f6800bef048"; // cmo
const DB = process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite";

function args(a) { const o = {}; for (let i = 0; i < a.length; i++) { if (!a[i].startsWith("--")) continue; const k = a[i].slice(2), n = a[i + 1]; if (!n || n.startsWith("--")) o[k] = true; else { o[k] = n; i++; } } return o; }
function die(c, m) { console.error("board-approval-create: " + m); process.exit(c); }
async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : {}; } catch { j = { raw: t }; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return j;
}

async function main() {
  const a = args(process.argv.slice(2));
  const leadId = a["lead-id"];
  if (!leadId) die(1, "missing --lead-id");
  if (!existsSync(DB)) die(1, "leads-db not found: " + DB);
  const db = new DatabaseSync(DB, { readOnly: true });
  const lead = db.prepare("SELECT id,name,niche,city,state,score,email,demo_url,stage FROM leads WHERE id=?").get(leadId);
  db.close();
  if (!lead) die(2, "lead not found: " + leadId);
  if (!lead.demo_url) die(2, "lead has no demo_url (not built?): " + leadId);

  const agentId = a["agent-id"] || DEFAULT_AGENT;
  const title = `Approve demo: ${lead.name}`;
  const where = [lead.city, lead.state].filter(Boolean).join(", ");
  const summary = `Lovable demo ready for outreach.\n` +
    `Company: ${lead.name}${where ? " (" + where + ")" : ""} - ${lead.niche || "home services"} - score ${lead.score}\n` +
    `Demo: ${lead.demo_url}\n` +
    (lead.email ? `Would send to: ${lead.email}\n` : `NO EMAIL on file - not emailable yet (needs enrichment/SMS).\n`) +
    `Approve to authorize the cold email; reject to skip.`;

  // 1) issue
  const issue = await api("POST", `/api/companies/${CID}/issues`, {
    title, description: summary, status: "in_review",
  });
  const issueId = issue.id;
  // 2) approval linked to it, carrying leadId for the auto-send step
  const appr = await api("POST", `/api/companies/${CID}/approvals`, {
    type: "request_board_approval",
    requestedByAgentId: agentId,
    issueIds: [issueId],
    payload: { title, summary, leadId: lead.id, demoUrl: lead.demo_url, toEmail: lead.email || null },
  });

  const out = { ok: true, leadId: lead.id, name: lead.name, issueId, approvalId: appr.id, emailable: !!lead.email };
  console.log(JSON.stringify(out, null, a.json ? 2 : 0));
}
main().catch((e) => die(1, e.message));
