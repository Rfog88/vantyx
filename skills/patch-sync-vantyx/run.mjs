#!/usr/bin/env node
// patch-sync-vantyx — weekly droplet → Rfog88/vantyx upstream sync.
//
// Reads droplet copies of agent/skill files, diffs against a fresh upstream
// clone, makes one commit per drifting entity, pushes, then PATCHes the
// per-cycle execution Issue with the audit report.
//
// Invocation: node skills/patch-sync-vantyx/run.mjs [--dry-run]

import { execFileSync } from "node:child_process";
import {
  mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { parseArgs } from "node:util";

const TOKEN = process.env.GITHUB_TOKEN_VANTYX;
const COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID;
const API_URL = process.env.PAPERCLIP_API_URL;
const API_KEY = process.env.PAPERCLIP_API_KEY;
const RUN_ID = process.env.PAPERCLIP_RUN_ID;
const TASK_ID = process.env.PAPERCLIP_TASK_ID;

if (!TOKEN) {
  console.error(JSON.stringify({ error: "api-key-missing", service: "github_vantyx" }));
  process.exit(3);
}
if (!COMPANY_ID || !API_URL || !API_KEY) {
  console.error(JSON.stringify({ error: "missing-paperclip-env", required: ["PAPERCLIP_COMPANY_ID", "PAPERCLIP_API_URL", "PAPERCLIP_API_KEY"] }));
  process.exit(3);
}

const { values: cliArgs } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false } },
});
const DRY_RUN = !!cliArgs["dry-run"];

const AGENT_FILES = ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"];
const SKILL_FILES = ["SKILL.md", "run.mjs"];
const ALLOWED_BASENAMES = new Set([...AGENT_FILES, ...SKILL_FILES]);

const DROPLET_AGENTS_ROOT = path.resolve(`/home/paperclip/.paperclip/instances/default/companies/${COMPANY_ID}/agents`);
const DROPLET_SKILLS_ROOT = path.resolve(`/home/paperclip/.paperclip/instances/default/skills/${COMPANY_ID}/__catalog__`);

const cycleId = crypto.randomUUID().slice(0, 8);
const today = new Date().toISOString().slice(0, 10);

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function safeWithinRoot(p, root) {
  const resolved = path.resolve(p);
  return resolved === root || resolved.startsWith(root + path.sep);
}

async function api(method, urlPath, body) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
  if (RUN_ID) headers["X-Paperclip-Run-Id"] = RUN_ID;
  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

async function fetchAgentMap() {
  const agents = await api("GET", `/api/companies/${COMPANY_ID}/agents`);
  const map = {};
  for (const a of agents) {
    if (a && a.id && a.urlKey) map[a.id] = a.urlKey;
  }
  return map;
}

function listSkillCatalogDirs() {
  if (!existsSync(DROPLET_SKILLS_ROOT)) return [];
  return readdirSync(DROPLET_SKILLS_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

function skillNameFromDir(dir) {
  const idx = dir.lastIndexOf("--");
  return idx > 0 ? dir.slice(0, idx) : dir;
}

function buffersEqual(a, b) {
  return a.length === b.length && a.equals(b);
}

async function main() {
  const cycleStartedAt = new Date().toISOString();
  const cloneDir = mkdtempSync(path.join(tmpdir(), `vantyx-sync-${cycleId}-`));

  let pushed = false;
  let commits = [];
  const skipped = { droplet_missing: 0, upstream_missing: 0, equal: 0 };
  const upstreamMissingLog = [];

  try {
    // 1. Clone — token interpolated via env-form URL (never logged).
    git(
      ["clone", "--depth", "1", `https://x-access-token:${TOKEN}@github.com/Rfog88/vantyx.git`, cloneDir],
      { stdio: "pipe" }
    );
    git(["-C", cloneDir, "config", "user.email", "noreply@paperclip.ing"]);
    git(["-C", cloneDir, "config", "user.name", "Paperclip patch-sync"]);

    // 2. Live mappings
    const agentMap = await fetchAgentMap();
    const skillDirs = listSkillCatalogDirs();

    // 3. Build (upstream, droplet, entity, basename) pairs
    const pairs = [];

    for (const [agentId, urlKey] of Object.entries(agentMap)) {
      const dropletAgentDir = path.join(DROPLET_AGENTS_ROOT, agentId, "instructions");
      if (!safeWithinRoot(dropletAgentDir, DROPLET_AGENTS_ROOT)) continue;
      for (const fname of AGENT_FILES) {
        pairs.push({
          upstreamRel: path.posix.join("agents", urlKey, fname),
          dropletAbs: path.join(dropletAgentDir, fname),
          entity: urlKey,
          basename: fname,
          kind: "agent",
        });
      }
    }

    for (const dir of skillDirs) {
      const name = skillNameFromDir(dir);
      const dropletSkillDir = path.join(DROPLET_SKILLS_ROOT, dir);
      if (!safeWithinRoot(dropletSkillDir, DROPLET_SKILLS_ROOT)) continue;
      for (const fname of SKILL_FILES) {
        pairs.push({
          upstreamRel: path.posix.join("skills", name, fname),
          dropletAbs: path.join(dropletSkillDir, fname),
          entity: name,
          basename: fname,
          kind: "skill",
        });
      }
    }

    // 4. Diff & stage
    const changesByEntity = new Map();

    for (const p of pairs) {
      if (!ALLOWED_BASENAMES.has(p.basename)) continue;
      if (!existsSync(p.dropletAbs)) { skipped.droplet_missing++; continue; }
      const upstreamAbs = path.join(cloneDir, p.upstreamRel);
      if (!existsSync(upstreamAbs)) {
        skipped.upstream_missing++;
        upstreamMissingLog.push(p.upstreamRel);
        continue;
      }
      const dropletBuf = readFileSync(p.dropletAbs);
      const upstreamBuf = readFileSync(upstreamAbs);
      if (buffersEqual(dropletBuf, upstreamBuf)) { skipped.equal++; continue; }

      if (!DRY_RUN) {
        writeFileSync(upstreamAbs, dropletBuf);
        git(["-C", cloneDir, "add", "--", p.upstreamRel]);
      }
      if (!changesByEntity.has(p.entity)) {
        changesByEntity.set(p.entity, { kind: p.kind, files: [] });
      }
      changesByEntity.get(p.entity).files.push({ basename: p.basename, upstreamRel: p.upstreamRel });
    }

    // 5. Commit per entity
    if (!DRY_RUN) {
      for (const [entity, info] of changesByEntity) {
        const fileList = info.files.map(f => f.basename).join(", ");
        const msg = `${entity}: sync droplet self-patch to ${fileList} (auto-sync of in-droplet self-patch)`;
        const filesArgs = info.files.map(f => f.upstreamRel);
        try {
          git(["-C", cloneDir, "commit", "-m", msg, "--", ...filesArgs]);
          const sha = git(["-C", cloneDir, "rev-parse", "HEAD"]);
          commits.push({ entity, kind: info.kind, files: info.files, sha, shortSha: sha.slice(0, 7) });
        } catch (e) {
          console.error(`[commit-failed] ${entity}: ${(e.stderr || e.message || "").toString().slice(0, 300)}`);
        }
      }
    } else {
      for (const [entity, info] of changesByEntity) {
        commits.push({ entity, kind: info.kind, files: info.files, sha: "(dry-run)", shortSha: "dryrun" });
      }
    }

    // 6. Push
    if (commits.length > 0 && !DRY_RUN) {
      git(["-C", cloneDir, "push", "origin", "HEAD:master"], { stdio: "pipe" });
      pushed = true;
    }

    // 7. Build per-cycle Issue body
    const cycleFinishedAt = new Date().toISOString();
    const bodyLines = [];
    bodyLines.push(`**Cycle**: \`${cycleId}\``);
    bodyLines.push(`**Started**: ${cycleStartedAt}`);
    bodyLines.push(`**Finished**: ${cycleFinishedAt}`);
    bodyLines.push(`**Mode**: ${DRY_RUN ? "dry-run (no push, no patch)" : "live"}`);
    bodyLines.push("");
    bodyLines.push(`Files scanned: ${pairs.length}. Droplet-missing: ${skipped.droplet_missing}. Upstream-missing: ${skipped.upstream_missing}. Byte-equal: ${skipped.equal}.`);
    if (upstreamMissingLog.length > 0) {
      bodyLines.push("");
      bodyLines.push("**Skills/agents not tracked upstream (skipped):**");
      for (const m of upstreamMissingLog.slice(0, 50)) bodyLines.push(`- \`${m}\``);
      if (upstreamMissingLog.length > 50) bodyLines.push(`- ...and ${upstreamMissingLog.length - 50} more`);
    }
    bodyLines.push("");

    if (commits.length === 0) {
      bodyLines.push("No drift detected this cycle.");
    } else {
      bodyLines.push("| Entity | Kind | Files | Commit |");
      bodyLines.push("|---|---|---|---|");
      for (const c of commits) {
        const filesStr = c.files.map(f => `\`${f.basename}\``).join(", ");
        const commitCell = DRY_RUN
          ? "_(dry-run)_"
          : `[\`${c.shortSha}\`](https://github.com/Rfog88/vantyx/commit/${c.sha})`;
        bodyLines.push(`| \`${c.entity}\` | ${c.kind} | ${filesStr} | ${commitCell} |`);
      }
    }
    const body = bodyLines.join("\n");

    // 8. PATCH execution Issue
    if (TASK_ID && !DRY_RUN) {
      const title = `Patch-sync cycle: ${today} (${commits.length} commit${commits.length === 1 ? "" : "s"})`;
      await api("PATCH", `/api/issues/${TASK_ID}`, {
        title,
        description: body,
        status: "done",
      });
    }

    // 9. JSON summary
    console.log(JSON.stringify({
      cycleId,
      date: today,
      commits: commits.map(c => ({
        entity: c.entity,
        kind: c.kind,
        files: c.files.map(f => f.basename),
        sha: c.sha,
      })),
      pushed,
      skipped,
      issuePatched: !!TASK_ID && !DRY_RUN,
      dryRun: DRY_RUN,
    }));
  } finally {
    try { rmSync(cloneDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "patch-sync-failed", message: e.message }));
  process.exit(1);
});
