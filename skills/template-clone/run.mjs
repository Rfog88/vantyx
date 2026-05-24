#!/usr/bin/env node
// template-clone — shallow-clone Vantyx Web OS into /tmp/demos/<slug>/.
//
// Invocation:
//   node skills/template-clone/run.mjs --lead-slug acme-electric [--target-dir /tmp/demos]

import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { existsSync, statSync, rmSync, mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";

const REPO = "https://github.com/Rfog88/vantyx-web-os.git";

function sanitizeSlug(slug) {
  return slug.replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

function dirSize(p) {
  try {
    const result = spawnSync("du", ["-sb", p], { encoding: "utf8" });
    if (result.status === 0) return parseInt(result.stdout.split(/\s/)[0], 10);
  } catch {}
  return null;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "lead-slug": { type: "string" },
      "target-dir": { type: "string", default: "/tmp/demos" },
    },
  });

  const rawSlug = values["lead-slug"];
  if (!rawSlug) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "missing lead-slug" }));
    process.exit(2);
  }
  const slug = sanitizeSlug(rawSlug);
  if (!slug) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "invalid lead-slug after sanitization", input: rawSlug }));
    process.exit(2);
  }

  const targetRoot = values["target-dir"];
  mkdirSync(targetRoot, { recursive: true });

  const finalPath = resolve(targetRoot, slug);
  const tempPath = resolve(targetRoot, `.${slug}-tmp-${Date.now()}`);

  // Clone into temp, then atomic-swap into final.
  const clone = spawnSync(
    "git",
    ["clone", "--depth", "1", "--quiet", REPO, tempPath],
    { encoding: "utf8" }
  );

  if (clone.status !== 0) {
    try { rmSync(tempPath, { recursive: true, force: true }); } catch {}
    console.error(JSON.stringify({
      error: "adapter-broken",
      service: "git-clone",
      message: clone.stderr?.trim() || `git exited ${clone.status}`,
    }));
    process.exit(5);
  }

  // Get HEAD SHA
  const head = spawnSync("git", ["-C", tempPath, "rev-parse", "HEAD"], { encoding: "utf8" });
  const headSha = head.status === 0 ? head.stdout.trim().substring(0, 8) : null;

  // Atomic swap
  if (existsSync(finalPath)) {
    const stale = resolve(targetRoot, `.${slug}-stale-${Date.now()}`);
    renameSync(finalPath, stale);
    rmSync(stale, { recursive: true, force: true });
  }
  renameSync(tempPath, finalPath);

  console.log(JSON.stringify({
    clone_path: finalPath,
    head_sha: headSha,
    size_bytes: dirSize(finalPath),
    slug,
  }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
