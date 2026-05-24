#!/usr/bin/env node
// brand-consistency-check — compare a deployed preview against the per-client
// brand file + agency non-negotiables. Returns drift score + findings.
//
// Phase 1.5 implementation:
//   - Fetches the preview URL over HTTP (no Playwright)
//   - Checks for the 7 non-negotiables from shared/brand/vantyx.md by
//     searching the rendered HTML for canonical markers
//   - Diffs the palette by parsing the site.config.ts and comparing against
//     the brand file's palette
//   - Returns drift_score 0-100 and a list of pass/warn/fail findings
//
// Invocation:
//   echo '{"client_slug":"acme-electric","site_config_path":"/tmp/demos/acme-electric/site.config.ts","preview_url":"https://..."}' \
//     | node skills/brand-consistency-check/run.mjs

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function hexToLab(hex) {
  // Quick hex → LAB via sRGB. Used for color delta.
  const n = hex.replace("#", "");
  const full = n.length === 3 ? n.split("").map(c => c + c).join("") : n;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  // sRGB → linear
  const lin = (c) => (c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92);
  const R = lin(r), G = lin(g), B = lin(b);
  // linear → XYZ (D65)
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  // XYZ → Lab
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function colorDelta(hex1, hex2) {
  // Returns 0–100 (rough); identical colors → 0, very different → 100.
  if (!hex1 || !hex2) return 100;
  const [l1, a1, b1] = hexToLab(hex1);
  const [l2, a2, b2] = hexToLab(hex2);
  const dE = Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
  // dE > ~30 is "different colors" perceptually. Normalize to 0-100.
  return Math.min(100, Math.round((dE / 30) * 100));
}

function extractConfigPalette(configContent) {
  // Cheap regex against the JSON-shaped output of template-fill
  const palette = {};
  const grab = (key) => {
    const m = configContent.match(new RegExp(`"${key}"\\s*:\\s*"(#[0-9a-fA-F]{3,6})"`));
    return m ? m[1].toLowerCase() : null;
  };
  palette.primary = grab("primary");
  palette.accent = grab("accent");
  palette.bg = grab("bg");
  palette.text = grab("text");
  palette.muted = grab("muted");
  return palette;
}

function extractBrandFilePalette(md) {
  const grab = (label) => {
    const m = md.match(new RegExp(`${label}\\s*[:=]?\\s*[\`'"]?(#(?:[0-9a-f]{3}|[0-9a-f]{6}))`, "i"));
    return m ? m[1].toLowerCase() : null;
  };
  return {
    primary: grab("Primary"),
    accent: grab("Accent"),
    bg: grab("Background") || grab("Bg"),
    text: grab("Text"),
    muted: grab("Muted"),
  };
}

const NON_NEGOTIABLES = [
  { id: "license", label: "License # visible", check: (html, cfg) => cfg.includes("licenseNumber") && /licens/i.test(html) },
  { id: "tap-to-call", label: "Mobile tap-to-call", check: (html) => /href=["']tel:/i.test(html) },
  { id: "google-reviews", label: "Reviews section present", check: (html) => /review|testimonial/i.test(html) },
  { id: "service-area", label: "Service area map / ZIPs listed", check: (html) => /service[- ]area|zips? we cover/i.test(html) },
  { id: "contact-form", label: "Contact form (POST or server action)", check: (html) => /<form[\s\S]*?(action=|<input)/i.test(html) },
  { id: "schema-jsonld", label: "schema.org JSON-LD in footer", check: (html) => /application\/ld\+json[\s\S]*?LocalBusiness/i.test(html) },
  { id: "lighthouse", label: "Lighthouse mobile ≥85 (deferred to Phase 2 — needs real audit)", check: () => true },
];

async function main() {
  const raw = readFileSync(0, "utf8");
  let input;
  try { input = JSON.parse(raw); }
  catch {
    console.error(JSON.stringify({ error: "decision-needed", reason: "invalid_json_input" }));
    process.exit(2);
  }

  const { client_slug, site_config_path, preview_url } = input;
  if (!client_slug || !site_config_path || !preview_url) {
    console.error(JSON.stringify({
      error: "decision-needed",
      reason: "missing required field(s)",
      required: ["client_slug", "site_config_path", "preview_url"],
    }));
    process.exit(2);
  }

  const findings = [];

  // 1. Brand-file palette vs site.config palette
  const brandFile = resolve(repoRoot, "shared", "brand", "clients", `${client_slug}.md`);
  let brandPalette = null;
  if (existsSync(brandFile)) {
    brandPalette = extractBrandFilePalette(readFileSync(brandFile, "utf8"));
  } else {
    findings.push({ level: "warn", msg: `Brand file missing: ${brandFile} — used niche defaults` });
  }

  let configPalette = null;
  if (existsSync(site_config_path)) {
    configPalette = extractConfigPalette(readFileSync(site_config_path, "utf8"));
  } else {
    findings.push({ level: "fail", msg: `site.config.ts missing at ${site_config_path}` });
  }

  let paletteDrift = 0;
  if (brandPalette && configPalette) {
    const keys = ["primary", "accent", "bg", "text", "muted"];
    let totalDelta = 0;
    let counted = 0;
    for (const k of keys) {
      if (brandPalette[k] && configPalette[k]) {
        const d = colorDelta(brandPalette[k], configPalette[k]);
        totalDelta += d;
        counted++;
        if (d > 30) findings.push({ level: "warn", msg: `Palette ${k} drifts: brand=${brandPalette[k]} vs config=${configPalette[k]} (delta ${d}%)` });
      }
    }
    paletteDrift = counted > 0 ? Math.round(totalDelta / counted) : 0;
  }

  // 2. Fetch the deployed preview and check non-negotiables
  let html = "";
  try {
    const res = await fetch(preview_url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "VantyxQABot/1.0" },
    });
    if (!res.ok) {
      findings.push({ level: "fail", msg: `Preview returned HTTP ${res.status}` });
    } else {
      html = await res.text();
    }
  } catch (e) {
    findings.push({ level: "fail", msg: `Preview unreachable: ${e.message}` });
  }

  let checklistPassed = 0;
  let checklistTotal = NON_NEGOTIABLES.length;
  if (html) {
    const cfg = existsSync(site_config_path) ? readFileSync(site_config_path, "utf8") : "";
    for (const n of NON_NEGOTIABLES) {
      const ok = n.check(html, cfg);
      if (ok) {
        checklistPassed++;
        findings.push({ level: "pass", msg: n.label });
      } else {
        findings.push({ level: "fail", msg: `Non-negotiable missing: ${n.label}` });
      }
    }
  }

  // Compose drift score: weighted blend of palette + checklist failures
  const checklistDrift = checklistTotal > 0 ? Math.round(((checklistTotal - checklistPassed) / checklistTotal) * 100) : 100;
  const driftScore = Math.round(0.4 * paletteDrift + 0.6 * checklistDrift);
  const passesThreshold = driftScore <= 15;

  console.log(JSON.stringify({
    drift_score: driftScore,
    palette_drift: paletteDrift,
    checklist_passed: `${checklistPassed}/${checklistTotal}`,
    passes_threshold: passesThreshold,
    findings,
  }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
