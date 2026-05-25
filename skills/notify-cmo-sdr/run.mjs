#!/usr/bin/env node
// notify-cmo-sdr — post a structured "demo ready" message via board-notify.
//
// Invocation:
//   echo '{"lead-name":"...","demo-url":"...","score":75,"niche":"electrician","city":"Lima, OH"}' \
//     | node skills/notify-cmo-sdr/run.mjs

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Locate a sibling skill's run.mjs. Skills are installed under
// `<root>/__catalog__/<name>--<hash>/run.mjs`, so resolve by scanning the
// parent catalog for an entry that matches the skill name (with or without
// the `--<hash>` suffix). Falls back to `<root>/skills/<name>/run.mjs` for
// dev layouts where skills live as plain directories.
function resolveSiblingSkill(name) {
  const catalogDir = dirname(here);
  if (existsSync(catalogDir) && statSync(catalogDir).isDirectory()) {
    const entries = readdirSync(catalogDir);
    const match = entries.find((d) => d === name || d.startsWith(`${name}--`));
    if (match) {
      const p = resolve(catalogDir, match, "run.mjs");
      if (existsSync(p)) return p;
    }
  }
  const devPath = resolve(here, "..", "..", "skills", name, "run.mjs");
  if (existsSync(devPath)) return devPath;
  throw new Error(`sibling skill not found: ${name} (searched ${catalogDir} and ${devPath})`);
}

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

  let scriptPath;
  try { scriptPath = resolveSiblingSkill("board-notify"); }
  catch (e) {
    console.error(JSON.stringify({
      error: "adapter-broken",
      service: "board-notify",
      reason: "board_notify_not_found",
      message: e.message,
    }));
    process.exit(5);
  }

  const proc = spawnSync(
    "node",
    [scriptPath],
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
