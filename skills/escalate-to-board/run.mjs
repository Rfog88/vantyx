#!/usr/bin/env node
// escalate-to-board — create a Paperclip Issue assigned to Board + fire board-notify.
// STATUS: Paperclip Issue-creation API call is stubbed pending endpoint confirmation.
// The board-notify Discord/SMS layer IS active in this version.
//
// Invocation: echo '{...}' | node skills/escalate-to-board/run.mjs

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const STANDARDIZED_REASONS = new Set([
  "api-key-missing",
  "subscription-rate-limit",
  "decision-needed",
  "external-quota-exceeded",
  "agent-conflict",
  "human-review-required",
  "adapter-broken",
  "unknown-failure",
]);

async function callBoardNotify(payload) {
  const proc = spawnSync(
    "node",
    [resolve(repoRoot, "skills", "board-notify", "run.mjs")],
    { input: JSON.stringify(payload), encoding: "utf8" }
  );
  if (proc.status !== 0) {
    return { status: "error", stderr: proc.stderr };
  }
  try { return JSON.parse(proc.stdout); } catch { return { status: "ok-unparsed", raw: proc.stdout }; }
}

async function createPaperclipIssue(input) {
  // TODO Commit 7 / Phase 1 deploy: replace with actual Paperclip API call.
  // Expected shape (to confirm with Ryan against live instance):
  //   POST {PAPERCLIP_API_URL}/api/issues
  //   { title, body, assigneeRole: "board", labels: ["pending_human", reason], parentId? }
  const apiUrl = process.env.PAPERCLIP_API_URL;
  const apiToken = process.env.PAPERCLIP_API_TOKEN;
  if (!apiUrl || !apiToken) {
    return { status: "stub", reason: "paperclip_api_not_configured", would_create: input };
  }
  // Placeholder for the live call; CTO confirms endpoint in Commit 7.
  return { status: "stub", reason: "endpoint_pending_confirmation", would_create: input };
}

async function main() {
  const raw = readFileSync(0, "utf8");
  let input;
  try { input = JSON.parse(raw); }
  catch { console.error(JSON.stringify({ error: "decision-needed", reason: "invalid_json_input" })); process.exit(2); }

  const { tier, reason, title, context, suggested_action, issue_url, agent_slug, error_signature } = input;

  if (![1, 2].includes(tier)) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "invalid_tier", tier }));
    process.exit(2);
  }
  if (!STANDARDIZED_REASONS.has(reason)) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "non_standard_reason", got: reason, allowed: Array.from(STANDARDIZED_REASONS) }));
    process.exit(2);
  }

  const body = [
    `**Reason:** \`${reason}\``,
    `**Agent:** \`${agent_slug}\``,
    `**Context:** ${context}`,
    suggested_action ? `**Suggested action:** ${suggested_action}` : null,
    error_signature ? `**Error signature:** \`${error_signature}\`` : null,
  ].filter(Boolean).join("\n");

  const issue = await createPaperclipIssue({ tier, reason, title, body, issue_url, agent_slug });

  const notifyResult = await callBoardNotify({
    tier,
    title,
    body,
    issue_url: issue.issue_id ? `${process.env.PAPERCLIP_API_URL}/issues/${issue.issue_id}` : issue_url,
    sms_on_tier_2: true,
  });

  console.log(JSON.stringify({ issue, notify: notifyResult }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
