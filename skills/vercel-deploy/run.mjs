#!/usr/bin/env node
// vercel-deploy — production deploy a per-lead Vantyx Web OS clone via Vercel CLI.
//
// Invocation:
//   node skills/vercel-deploy/run.mjs --clone-path /tmp/demos/<slug> --lead-slug <slug> [--lead-id <id>] [--scope rfog88s-projects]

import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const VERCEL_API_BASE = "https://api.vercel.com";

function canonicalizePreviewUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (!/^https?:$/i.test(u.protocol)) return null;
    if (!u.hostname.toLowerCase().endsWith(".vercel.app")) return null;
    // Strip build-hash+scope: slug-HASH-SCOPE.vercel.app → slug.vercel.app
    // Vercel deployment build hash is exactly 9 alnum chars (e.g. gqpz3lrgv, kqufs8t3d)
    const stripped = u.hostname.replace(/-[a-z0-9]{9}-[a-z0-9][a-z0-9-]*(\.vercel\.app)$/i, "$1");
    u.hostname = stripped;
    u.protocol = "https:";
    u.pathname = "/";
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function sanitizeSlug(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegex(raw) {
  return String(raw).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function vercelApiRequest({ token, scope, method = "GET", path, body = null }) {
  const url = new URL(path, VERCEL_API_BASE);
  if (scope) url.searchParams.set("slug", scope);
  const curlArgs = [
    "-sS",
    "-X",
    method,
    "-H",
    `Authorization: Bearer ${token}`,
    "-H",
    "Content-Type: application/json",
    url.toString(),
  ];
  if (body !== null) curlArgs.splice(curlArgs.length - 1, 0, "--data-raw", JSON.stringify(body));
  const proc = spawnSync(
    "curl",
    curlArgs,
    { encoding: "utf8" },
  );
  if (proc.status !== 0) {
    throw new Error(`vercel api ${method} ${path} failed: ${proc.stderr || proc.stdout || "unknown error"}`);
  }
  const out = (proc.stdout || "").trim();
  if (!out) return {};
  const parsed = JSON.parse(out);
  if (parsed && parsed.error) {
    throw new Error(`vercel api ${method} ${path} returned error: ${JSON.stringify(parsed.error)}`);
  }
  return parsed;
}

function listProjects({ token, scope }) {
  const response = vercelApiRequest({
    token,
    scope,
    method: "GET",
    path: "/v9/projects?limit=100",
  });
  return Array.isArray(response.projects) ? response.projects : [];
}

function deleteProject({ token, scope, id }) {
  return vercelApiRequest({
    token,
    scope,
    method: "DELETE",
    path: `/v9/projects/${encodeURIComponent(id)}`,
  });
}

function updateProject({ token, scope, id, body }) {
  return vercelApiRequest({
    token,
    scope,
    method: "PATCH",
    path: `/v9/projects/${encodeURIComponent(id)}`,
    body,
  });
}

function classifyRetiredHashPrefixedProjects({ projects, canonicalProjectName, normalizedSlug }) {
  const slugPattern = escapeRegex(normalizedSlug);
  const legacyNameMatchers = [
    new RegExp(`^preview-${slugPattern}-[a-z0-9]{6,}$`, "i"),
    new RegExp(`^[a-z0-9]{6,}-preview-${slugPattern}$`, "i"),
    new RegExp(`^[a-z0-9]{6,}-${slugPattern}$`, "i"),
  ];
  return projects.filter((p) => {
    const name = String(p?.name || "");
    if (!name || name === canonicalProjectName) return false;
    if (!name.includes(normalizedSlug)) return false;
    return legacyNameMatchers.some((rx) => rx.test(name));
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      "clone-path": { type: "string" },
      "lead-slug": { type: "string" },
      "lead-id": { type: "string" },
      scope: { type: "string", default: process.env.VERCEL_SCOPE || "rfog88s-projects" },
    },
  });

  const clonePath = values["clone-path"];
  const slug = values["lead-slug"];
  const leadId = values["lead-id"] || null;
  const normalizedSlug = sanitizeSlug(slug);

  if (!clonePath || !slug || !normalizedSlug) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "missing required arg(s)", got: { clonePath, slug } }));
    process.exit(2);
  }
  if (!existsSync(clonePath) || !statSync(clonePath).isDirectory()) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "clone-path missing or not a directory", clonePath }));
    process.exit(2);
  }
  // Deployability check. A Lovable export is a static/Vite app — require either a
  // package.json with a `build` script (Vite/React) or a bare index.html. This
  // replaces the retired site.config.ts fixture guard: the in-house vantyx-web-os
  // template is gone, and a Lovable app has no site.config.ts, so the old guard
  // blocked every deploy. We still refuse to deploy an empty/garbage directory.
  {
    const pkgPath = join(clonePath, "package.json");
    const indexPath = join(clonePath, "index.html");
    let deployable = false;
    let detail = "";
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg?.scripts && typeof pkg.scripts.build === "string" && pkg.scripts.build.trim()) {
          deployable = true;
        } else {
          detail = "package.json present but has no build script";
        }
      } catch (e) {
        detail = `package.json unparseable: ${e.message}`;
      }
    } else if (existsSync(indexPath)) {
      deployable = true;
    } else {
      detail = "no package.json (with build script) or index.html found";
    }
    if (!deployable) {
      console.error(JSON.stringify({
        error: "decision-needed",
        reason: "clone-path is not a deployable static/Vite app",
        detail,
        clonePath,
      }));
      process.exit(2);
    }
  }

  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    console.error(JSON.stringify({ error: "api-key-missing", service: "vercel" }));
    process.exit(3);
  }

  // VAN-197: deterministic project naming is now one project per lead slug.
  const projectName = `preview-${normalizedSlug}`.substring(0, 52); // Vercel project name max 52 chars
  const scope = values.scope;
  const retiredCleanup = {
    candidates: [],
    deleted: [],
    failed: [],
  };
  try {
    const projects = listProjects({ token, scope });
    const retiredProjects = classifyRetiredHashPrefixedProjects({
      projects,
      canonicalProjectName: projectName,
      normalizedSlug,
    });
    retiredCleanup.candidates = retiredProjects.map((p) => ({ id: p.id || null, name: p.name || null }));
    for (const p of retiredProjects) {
      try {
        if (!p.id) throw new Error("missing project id");
        deleteProject({ token, scope, id: p.id });
        retiredCleanup.deleted.push({ id: p.id, name: p.name || null });
      } catch (e) {
        retiredCleanup.failed.push({ id: p.id || null, name: p.name || null, reason: e.message });
      }
    }
  } catch (e) {
    // Cleanup is best-effort; deploy continues while returning the cleanup failure detail.
    retiredCleanup.failed.push({ id: null, name: null, reason: e.message });
  }

  const args = [
    "--prod",
    "--yes",                    // skip interactive prompts
    "--token", token,
    "--scope", scope,
    "--name", projectName,
  ];

  // Clear stale .vercel/project.json so --name is source of truth for project
  // linkage. Prevents cross-workspace alias contamination (VAN-172).
  try { rmSync(join(clonePath, ".vercel"), { recursive: true, force: true }); } catch {}

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
  const vercelHostUrlMatch = stdout.match(/https?:\/\/[a-z0-9-]+\.vercel\.app(?:[/?#][^\s]*)?/i);
  const fallbackLine = stdout.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  const candidateUrl = vercelHostUrlMatch ? vercelHostUrlMatch[0] : fallbackLine;
  const canonicalPreviewUrl = canonicalizePreviewUrl(candidateUrl);
  if (!canonicalPreviewUrl) {
    console.error(JSON.stringify({
      error: "adapter-broken",
      service: "vercel",
      reason: "unable to parse canonical *.vercel.app preview URL from Vercel output",
      stdout_tail: stdout.split("\n").slice(-10).join("\n"),
      stderr_tail: stderr.split("\n").slice(-10).join("\n"),
      candidate_url: candidateUrl || null,
      duration_ms,
    }));
    process.exit(5);
  }

  // Best-effort extract IDs (Vercel CLI logs these in stderr when verbose)
  const projectMatch = (stderr + stdout).match(/prj_[A-Za-z0-9]+/);
  const deploymentMatch = (stderr + stdout).match(/dpl_[A-Za-z0-9]+/);
  const projectIdFromLogs = projectMatch?.[0] || null;

  // VAN-300: enforce public preview access for each freshly deployed project.
  // VAN-232 was one-time infra cleanup; this is the deploy-time guardrail.
  let protection = {
    attempted: false,
    ok: false,
    project_id: projectIdFromLogs,
    error: null,
  };
  try {
    let projectId = projectIdFromLogs;
    if (!projectId) {
      const projects = listProjects({ token, scope });
      const project = projects.find((p) => String(p?.name || "") === projectName);
      projectId = project?.id || null;
    }
    if (!projectId) {
      throw new Error(`could not resolve project id for ${projectName}`);
    }
    protection.attempted = true;
    protection.project_id = projectId;

    const patchBody = {
      passwordProtection: null,
      ssoProtection: null,
    };
    updateProject({ token, scope, id: projectId, body: patchBody });

    // Read-back check: fail closed if protection still appears enabled.
    const refreshed = vercelApiRequest({
      token,
      scope,
      method: "GET",
      path: `/v9/projects/${encodeURIComponent(projectId)}`,
    });
    const hasPasswordProtection = !!refreshed?.passwordProtection;
    const hasSsoProtection = !!refreshed?.ssoProtection;
    if (hasPasswordProtection || hasSsoProtection) {
      throw new Error("project protection still enabled after patch");
    }
    protection.ok = true;
  } catch (e) {
    protection.error = e.message;
    console.error(JSON.stringify({
      error: "adapter-broken",
      service: "vercel",
      reason: "failed to disable project deployment protection",
      project_name: projectName,
      protection,
      duration_ms,
    }));
    process.exit(5);
  }

  console.log(JSON.stringify({
    url: canonicalPreviewUrl,
    preview_url: canonicalPreviewUrl,
    project_name: projectName,
    lead_suffix: leadId
      ? String(leadId).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)
      : null,
    project_id: protection.project_id,
    deployment_id: deploymentMatch?.[0] || null,
    protection,
    retired_hash_projects_deleted: retiredCleanup.deleted.length,
    retired_hash_projects_failed: retiredCleanup.failed.length,
    retired_hash_projects: retiredCleanup,
    duration_ms,
  }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
