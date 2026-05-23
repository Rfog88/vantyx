#!/usr/bin/env node
// brand-extract — STUB for Phase 1.5.
// Full Playwright implementation deferred. See SKILL.md for the target schema.
//
// When this runs in Phase 1, it returns a minimal payload using only the
// website URL + cheap heuristics, so UXDesigner can still author a brand
// file in degraded mode.

import { parseArgs } from "node:util";

async function main() {
  const { values } = parseArgs({
    options: {
      "lead-id": { type: "string" },
      url: { type: "string" },
    },
  });

  const { url } = values;
  if (!url) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "missing url" }));
    process.exit(2);
  }

  // TODO Phase 1.5: replace with Playwright headless + color-thief + opengraph parsing.
  // For now, return a stub payload so the downstream pipeline doesn't break.
  const stub = {
    logo_url: null,
    palette: ["#0F172A", "#F59E0B", "#FFFFFF"],
    fonts: ["Inter", "system-ui"],
    h1_voice_sample: null,
    services: [],
    nap: { phone: null, address: null, hours: null },
    _status: "stub-phase-1.5",
    _next: "developer to implement Playwright extraction in Phase 1.5 per plan Section 4",
  };

  console.log(JSON.stringify(stub));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
