#!/usr/bin/env node
// load-brand — read shared/brand/vantyx.md (+ optional client overlay).
// Invocation: node skills/load-brand/run.mjs [--client-slug <slug>]

import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

async function main() {
  const { values } = parseArgs({
    options: { "client-slug": { type: "string" } },
  });
  const clientSlug = values["client-slug"] || null;

  const agencyPath = resolve(repoRoot, "shared", "brand", "vantyx.md");
  let agencyBrand;
  try {
    agencyBrand = await readFile(agencyPath, "utf8");
  } catch (e) {
    console.error(JSON.stringify({ error: "unknown-failure", reason: "agency_brand_missing", path: agencyPath }));
    process.exit(3);
  }

  let output = `# Vantyx Brand\n\n${agencyBrand}`;

  if (clientSlug) {
    const clientPath = resolve(repoRoot, "shared", "brand", "clients", `${clientSlug}.md`);
    try {
      const clientBrand = await readFile(clientPath, "utf8");
      output += `\n\n---\n\n# Client Brand: ${clientSlug}\n\n${clientBrand}`;
    } catch (e) {
      output = `<!-- _warning: client_brand_missing slug=${clientSlug} -->\n` + output;
    }
  }

  process.stdout.write(output);
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
