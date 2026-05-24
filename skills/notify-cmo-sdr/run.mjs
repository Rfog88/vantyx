#!/usr/bin/env node
// notify-cmo-sdr — post a structured "demo ready" message via board-notify.
//
// Invocation:
//   echo '{"lead-name":"...","demo-url":"...","score":75,"niche":"electrician","city":"Lima, OH"}' \
//     | node skills/notify-cmo-sdr/run.mjs

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

async function main() {
  const raw = readFileSync(0, "utf8");
  let input;
  try { input = JSON.parse(raw); }
  catch {
    console.error(JSON.stringify({ error: "decision-needed", reason: "invalid_json_input" }));
    process.exit(2);
  }

  const leadName = input["lead-name"] || input.lead_name;
  const demoUrl = input["demo-url"] || input.demo_url;
  const score = input.score;
  const niche = input.niche;
  const city = input.city;

  if (!leadName || !demoUrl || score == null) {
    console.error(JSON.stringify({
      error: "decision-needed",
      reason: "missing required field(s)",
      required: ["lead-name", "demo-url", "score"],
      got: { leadName, demoUrl, score },
    }));
    process.exit(2);
  }

  const title = `Demo ready: ${leadName}`;
  const body = [
    `**Lead:** ${leadName}`,
    niche ? `**Niche:** ${niche}` : null,
    city ? `**Location:** ${city}` : null,
    `**Score:** ${score}`,
    `**Preview:** ${demoUrl}`,
    "",
    "_Outreach: send the preview link with the existing template; no edit needed unless brand-extract had warnings._",
  ].filter(Boolean).join("\n");

  const proc = spawnSync(
    "node",
    [resolve(repoRoot, "skills", "board-notify", "run.mjs")],
    {
      input: JSON.stringify({ tier: 0, title, body, sms_on_tier_2: false }),
      encoding: "utf8",
    }
  );

  if (proc.status !== 0) {
    console.error(JSON.stringify({
      error: "adapter-broken",
      service: "board-notify",
      stderr_tail: (proc.stderr || "").split("\n").slice(-5).join("\n"),
    }));
    process.exit(5);
  }

  let bn;
  try { bn = JSON.parse(proc.stdout || "{}"); } catch { bn = { raw: proc.stdout }; }

  console.log(JSON.stringify({ posted: true, channel: "discord-default", board_notify: bn }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
