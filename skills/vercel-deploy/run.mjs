#!/usr/bin/env node
// vercel-deploy — production deploy a per-lead Vantyx Web OS clone via Vercel CLI.
//
// Invocation:
//   node skills/vercel-deploy/run.mjs --clone-path /tmp/demos/<slug> --lead-slug <slug> [--scope vantyx]

import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

async function main() {
  const { values } = parseArgs({
    options: {
      "clone-path": { type: "string" },
      "lead-slug": { type: "string" },
      scope: { type: "string", default: process.env.VERCEL_SCOPE || "vantyx" },
    },
  });

  const clonePath = values["clone-path"];
  const slug = values["lead-slug"];

  if (!clonePath || !slug) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "missing required arg(s)", got: { clonePath, slug } }));
    process.exit(2);
  }
  if (!existsSync(clonePath) || !statSync(clonePath).isDirectory()) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "clone-path missing or not a directory", clonePath }));
    process.exit(2);
  }

  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    console.error(JSON.stringify({ error: "api-key-missing", service: "vercel" }));
    process.exit(3);
  }

  const projectName = `preview-${slug}`.substring(0, 52);   // Vercel project name max 52 chars
  const args = [
    "--prod",
    "--yes",                    // skip interactive prompts
    "--token", token,
    "--scope", values.scope,
    "--name", projectName,
  ];

  const t0 = Date.now();
  const proc = spawnSync("vercel", args, {
    cwd: clonePath,
    encoding: "utf8",
    env: { ...process.env, VERCEL_TOKEN: token },
  });
  const duration_ms = Date.now() - t0;

  // Vercel CLI writes the URL to stdout on success.
  const stdout = (proc.stdout || "").trim();
  const stderr = (proc.stderr || "").trim();

  if (proc.status !== 0) {
    // Classify the failure
    const lower = (stdout + " " + stderr).toLowerCase();
    let errorKind = "adapter-broken";
    if (/(401|403|forbidden|unauthorized|token)/.test(lower)) errorKind = "api-key-missing";
    else if (/(429|too many|quota|limit|exceeded)/.test(lower)) errorKind = "external-quota-exceeded";

    console.error(JSON.stringify({
      error: errorKind,
      service: "vercel",
      exit_status: proc.status,
      stdout_tail: stdout.split("\n").slice(-10).join("\n"),
      stderr_tail: stderr.split("\n").slice(-10).join("\n"),
      duration_ms,
    }));
    process.exit(errorKind === "api-key-missing" ? 3 : errorKind === "external-quota-exceeded" ? 4 : 5);
  }

  // Parse URL from stdout (Vercel CLI prints it as the last non-empty line typically)
  const urlMatch = stdout.match(/https:\/\/[a-z0-9\-]+\.vercel\.app\b/i);
  const url = urlMatch ? urlMatch[0] : stdout.split("\n").map(l => l.trim()).filter(Boolean).pop();

  // Best-effort extract IDs (Vercel CLI logs these in stderr when verbose)
  const projectMatch = (stderr + stdout).match(/prj_[A-Za-z0-9]+/);
  const deploymentMatch = (stderr + stdout).match(/dpl_[A-Za-z0-9]+/);

  console.log(JSON.stringify({
    url,
    project_id: projectMatch?.[0] || null,
    deployment_id: deploymentMatch?.[0] || null,
    duration_ms,
  }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
