#!/usr/bin/env node
// brand-consistency-check — STUB for Phase 1.5.
// Full implementation deferred. See SKILL.md for target schema.

import { readFileSync } from "node:fs";

async function main() {
  const raw = readFileSync(0, "utf8");
  let input;
  try { input = JSON.parse(raw); }
  catch { console.error(JSON.stringify({ error: "decision-needed", reason: "invalid_json_input" })); process.exit(2); }

  // TODO Phase 1.5: real implementation.
  //  1. Parse site.config.ts (regex-extract palette / fonts / phone / address).
  //  2. Fetch preview_url (Playwright headless) + screenshot.
  //  3. Color-quantize the screenshot, compare against brand palette in LAB space.
  //  4. Run Lighthouse audit on preview_url.
  //  5. Verify the 7 non-negotiables from shared/brand/vantyx.md.
  //  6. Return drift_score + findings.

  console.log(JSON.stringify({
    drift_score: 0,
    passes_threshold: true,
    findings: ["stub: brand-consistency-check not yet implemented (Phase 1.5)"],
    _status: "stub-phase-1.5",
    _next: "developer to implement when CTO files the Issue",
  }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
