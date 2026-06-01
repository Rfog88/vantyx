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
import { CITY_CENTROID_ROWS } from "./centroids.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function canonicalizePreviewUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { ok: false, reason: "empty preview_url" };
  }
  const trimmed = rawUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "preview_url is not a valid URL", input: trimmed };
  }

  if (parsed.protocol.toLowerCase() !== "https:") {
    return { ok: false, reason: "preview_url must use https", canonical: parsed.toString(), input: trimmed };
  }
  const hostname = parsed.hostname.toLowerCase();
  const isVercel = hostname.endsWith(".vercel.app");
  // VAN-229: prevent stale-alias QA checks. Canonical target is the exact
  // hash URL from leads.demo_url / gate preview-url, not preview-<slug>.vercel.app.
  const isPreviewHost = /^preview-[a-z0-9-]+\.vercel\.app$/i.test(hostname);
  const hasDeploymentHashAndScope = /-[a-z0-9]{9}-[a-z0-9][a-z0-9-]*\.vercel\.app$/i.test(hostname);
  const isDeprecatedBarePreviewAlias = isPreviewHost && !hasDeploymentHashAndScope;
  if (isDeprecatedBarePreviewAlias) {
    return {
      ok: false,
      reason: "preview_url must be the canonical hash deployment URL from leads.demo_url (bare preview alias is deprecated)",
      canonical: parsed.toString(),
      input: trimmed,
    };
  }
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return { ok: true, canonical: parsed.toString(), isVercel, input: trimmed };
}

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
  const fromTable = {};
  const tokenMap = {
    primary: "primary",
    accent: "accent",
    bg: "bg",
    background: "bg",
    text: "text",
    muted: "muted",
  };
  for (const line of String(md).split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cols = line.split("|").map((s) => s.trim()).filter(Boolean);
    if (cols.length < 2) continue;
    const rawToken = cols[0].toLowerCase();
    const token = tokenMap[rawToken];
    if (!token) continue;
    const hexMatch = cols[1].match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})/i);
    if (!hexMatch) continue;
    fromTable[token] = hexMatch[0].toLowerCase();
  }

  const grabInlineLast = (label) => {
    const matches = [...String(md).matchAll(new RegExp(`${label}\\s*[:=]?\\s*[\`'"]?(#(?:[0-9a-f]{6}|[0-9a-f]{3}))`, "gi"))];
    if (matches.length === 0) return null;
    return matches[matches.length - 1][1].toLowerCase();
  };

  return {
    primary: fromTable.primary || grabInlineLast("Primary"),
    accent: fromTable.accent || grabInlineLast("Accent"),
    bg: fromTable.bg || grabInlineLast("Background") || grabInlineLast("Bg"),
    text: fromTable.text || grabInlineLast("Text"),
    muted: fromTable.muted || grabInlineLast("Muted"),
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
const LICENSE_PLACEHOLDER_RE = /^[x0]{4,}$|^placeholder$|^license\s*#?$|^$/i;

// --- VAN-124: subIssueChecks support --------------------------------------
// Per-family pass/fail surfaced alongside drift_score so demo-gen / Cipher
// can route the right reconciliation issue instead of guessing.

const SUB_ISSUE_FAMILIES = [
  "slots_present",
  "geo_city_consistency",
  "no_unsplash",
  "brand_chrome_present",
  "payload_fidelity",
  "license_render",
];

// VAN-131 / Board policy 06e8edd9: labeled-pending license rendering rules.
// Supersedes the prior VAN-66 auto-suppression path. Trust comes from honest
// labeling, not from hiding the slot.
const LICENSE_PLACEHOLDER_LEAD_RE = /^[x0]{4,}$|placeholder|tbd|unknown/i;
const LICENSE_PENDING_LABEL = "License verification pending";
const LICENSE_SLOT_OPEN_RE = /<([a-z][a-z0-9]*)\b[^>]*\sdata-placeholder-slot\s*=\s*["']license["'][^>]*>/i;
const LICENSE_AREA_DISCLOSURE_RE = /concept|demo|pending|verification/i;

const EARTH_RADIUS_MI = 3958.761;

function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (x) => x * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestCityFromLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = null;
  let bestDist = Infinity;
  for (const row of CITY_CENTROID_ROWS) {
    const d = haversineMiles(lat, lng, row.lat, row.lng);
    if (d < bestDist) {
      bestDist = d;
      best = row;
    }
  }
  return best ? { ...best, miles: bestDist } : null;
}

function parseJsonLdLocalBusiness(html) {
  // Extract the first LocalBusiness JSON-LD block, return geo + addressLocality.
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    let obj;
    try { obj = JSON.parse(raw); } catch { continue; }
    const items = Array.isArray(obj) ? obj : (obj["@graph"] ? obj["@graph"] : [obj]);
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const t = item["@type"];
      const isLB = t === "LocalBusiness"
        || (Array.isArray(t) && t.includes("LocalBusiness"))
        || (typeof t === "string" && /LocalBusiness|Electrician|HomeAndConstructionBusiness/i.test(t));
      if (!isLB) continue;
      const geo = item.geo || {};
      const address = item.address || {};
      return {
        lat: Number(geo.latitude),
        lng: Number(geo.longitude),
        addressLocality: String(address.addressLocality || "").trim(),
      };
    }
  }
  return null;
}

function extractSiteConfigArray(configContent, key) {
  // Scrape the bracketed array value for top-level "key": [ ... ].
  const re = new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`);
  const m = configContent.match(re);
  if (!m) return [];
  const inner = m[1];
  const strs = [...inner.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((mm) => mm[1]);
  return strs;
}

function extractGalleryImageUrls(configContent) {
  // Walk gallery array entries and pick out the `src` / `url` fields.
  const m = configContent.match(/"gallery"\s*:\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  const inner = m[1];
  const out = [];
  const re = /"(?:src|url|image|imageUrl)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let mm;
  while ((mm = re.exec(inner)) !== null) out.push(mm[1]);
  return out;
}

function evaluateSlotsPresent(html) {
  const placeholderCount = (html.match(/data-placeholder-slot\s*=/gi) || []).length;
  const trustCount = (html.match(/data-trust-slot\s*=/gi) || []).length;
  const passed = (placeholderCount + trustCount) > 0;
  return {
    passed,
    evidence: `data-placeholder-slot count = ${placeholderCount}; data-trust-slot count = ${trustCount}`,
  };
}

function evaluateGeoCityConsistencyHtml(html) {
  const ld = parseJsonLdLocalBusiness(html);
  if (!ld) {
    return {
      passed: false,
      evidence: "No LocalBusiness JSON-LD with geo+address.addressLocality found in rendered HTML",
    };
  }
  if (!Number.isFinite(ld.lat) || !Number.isFinite(ld.lng)) {
    return {
      passed: false,
      evidence: `JSON-LD geo missing/invalid (latitude=${ld.lat}, longitude=${ld.lng}); address.addressLocality=${ld.addressLocality || "(missing)"}`,
    };
  }
  if (!ld.addressLocality) {
    return {
      passed: false,
      evidence: `JSON-LD address.addressLocality missing (geo=${ld.lat},${ld.lng})`,
    };
  }
  const nearest = nearestCityFromLatLng(ld.lat, ld.lng);
  const resolved = nearest ? nearest.locality : null;
  if (!resolved) {
    return {
      passed: false,
      evidence: `JSON-LD geo.latitude=${ld.lat} geo.longitude=${ld.lng} did not reverse-geocode to a known locality; address.addressLocality=${ld.addressLocality}`,
    };
  }
  const match = resolved.toLowerCase() === ld.addressLocality.toLowerCase();
  if (!match) {
    return {
      passed: false,
      evidence: `JSON-LD geo.latitude=${ld.lat} resolves to ${resolved} ${nearest.state}; address.addressLocality=${ld.addressLocality}`,
    };
  }
  return {
    passed: true,
    evidence: `JSON-LD geo.latitude=${ld.lat} resolves to ${resolved} ${nearest.state} (${nearest.miles.toFixed(1)} mi); address.addressLocality=${ld.addressLocality}`,
  };
}

function evaluateNoUnsplash(html) {
  // Strip <script> blocks first — Next.js hydration payloads serialize URLs
  // into scripts which double-counts hits. We only care about user-visible
  // refs.
  const visible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  // Detect both plain (`https://images.unsplash.com/...`) and URL-encoded
  // forms (`_next/image?url=https%3A%2F%2Fimages.unsplash.com%2F...`). The
  // Next.js Image component proxies remote images through `/_next/image`,
  // which URL-encodes the source, so a plain hostname grep misses these.
  const plain = [...visible.matchAll(/https?:\/\/(?:images|source|plus)\.unsplash\.com\/[^\s"'<>)]+/gi)]
    .map((m) => m[0]);
  const encoded = [...visible.matchAll(/https%3A%2F%2F(?:images|source|plus)\.unsplash\.com%2F[^\s"'<>)&]+/gi)]
    .map((m) => decodeURIComponent(m[0]));
  const hits = [...plain, ...encoded];
  if (hits.length === 0) {
    return { passed: true, evidence: "0 unsplash.com refs in rendered HTML" };
  }
  const sample = hits.slice(0, 3).map((u) => u.length > 80 ? u.slice(0, 77) + "..." : u);
  return {
    passed: false,
    evidence: `Found ${hits.length} unsplash.com refs: ${sample.join(", ")}${hits.length > 3 ? ` (+${hits.length - 3} more)` : ""}`,
  };
}

function evaluateBrandChromePresent(html) {
  const stickyNav = /<(?:header|nav)\b[^>]*class=["'][^"']*\bsticky\b/i.test(html)
    || /position\s*:\s*sticky/i.test(html)
    || /\bsticky\s+top-0\b/i.test(html);
  const footerMatch = html.match(/<footer\b[\s\S]*?<\/footer>/i);
  const footerInner = footerMatch ? footerMatch[0] : "";
  const footerBadgeBlock = !!footerInner && (
    /\bbadge\b/i.test(footerInner)
    || /application\/ld\+json/i.test(footerInner)
    || /licens/i.test(footerInner)
  );
  // 3-item trust strip: explicit `data-trust-strip*` markers preferred, else
  // count of trust-strip-flavored trust slots, else count of common third-
  // party trust labels in the page.
  let trustStripCount = (html.match(/data-trust-strip\b/gi) || []).length;
  if (trustStripCount < 3) {
    const trustStripSlots = (html.match(/data-trust-slot\s*=\s*["'](?:trust-strip|badge|trust-bar)[^"']*["']/gi) || []).length;
    if (trustStripSlots > trustStripCount) trustStripCount = trustStripSlots;
  }
  if (trustStripCount < 3) {
    const labels = (html.match(/\b(BBB|Better Business Bureau|Google|Yelp|Facebook|Licensed|Insured|Bonded|Same-?Day|24\/7)\b/gi) || []);
    const uniq = new Set(labels.map((s) => s.toLowerCase()));
    if (uniq.size > trustStripCount) trustStripCount = uniq.size;
  }
  const trustStripOk = trustStripCount >= 3;
  const passed = stickyNav && footerBadgeBlock && trustStripOk;
  const parts = [];
  parts.push(`sticky nav ${stickyNav ? "present" : "absent"}`);
  parts.push(`footer badge block ${footerBadgeBlock ? "present" : "absent"}`);
  parts.push(`trust strip ${trustStripCount}-item${trustStripOk ? "" : " (need ≥3)"}`);
  return { passed, evidence: parts.join("; ") };
}

function evaluatePayloadFidelity(html, configContent) {
  if (!configContent) {
    return { passed: false, evidence: "site.config.ts not loaded — cannot verify payload fidelity" };
  }
  // extractSiteConfigField's non-greedy `{...}` walker mis-matches deeply
  // nested paths because the regex consumes the first inner `}` before the
  // outer block closes. For the four fields here we know each name appears
  // exactly once in template-fill output, so a direct top-level field grab
  // is both correct and simpler.
  const grabScalar = (key) => {
    const m = configContent.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
    return m ? m[1] : "";
  };
  const phone = grabScalar("phone");
  const city = grabScalar("city");
  const license = grabScalar("licenseNumber");
  const images = extractGalleryImageUrls(configContent);

  const failures = [];
  if (phone) {
    const phoneDigits = phone.replace(/\D/g, "");
    const htmlDigits = html.replace(/\D/g, "");
    if (phoneDigits && !htmlDigits.includes(phoneDigits)) {
      failures.push(`phone "${phone}" not in rendered HTML`);
    }
  }
  if (city) {
    const esc = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\\b${esc}\\b`, "i").test(html)) {
      failures.push(`city "${city}" not in rendered HTML`);
    }
  }
  if (license && !LICENSE_PLACEHOLDER_RE.test(license)) {
    if (!html.includes(license)) {
      failures.push(`license_no "${license}" not in rendered HTML`);
    }
  }
  if (images.length > 0) {
    let matched = 0;
    for (const src of images) { if (html.includes(src)) matched++; }
    if (matched === 0) {
      failures.push(`0 of ${images.length} gallery image URLs found in rendered HTML`);
    }
  }
  if (failures.length === 0) {
    const parts = [];
    if (phone) parts.push("phone");
    if (images.length > 0) parts.push("image_sources");
    if (license && !LICENSE_PLACEHOLDER_RE.test(license)) parts.push("license_no");
    if (city) parts.push("city");
    const what = parts.length ? parts.join(", ") : "checked fields";
    return { passed: true, evidence: `${what} all agree with rendered HTML` };
  }
  return { passed: false, evidence: failures.join("; ") };
}

export {
  evaluateSlotsPresent,
  evaluateGeoCityConsistencyHtml,
  evaluateNoUnsplash,
  evaluateBrandChromePresent,
  evaluatePayloadFidelity,
  evaluateLicenseNoRawPlaceholder,
  evaluateLicenseFieldRender,
  evaluateLicenseRender,
  evaluateSubIssueChecks,
  shouldSuppressLicenseNonNegotiable,
  parseJsonLdLocalBusiness,
  nearestCityFromLatLng,
};

function stripScriptsAndStyles(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

function isPlaceholderLicenseLead(licenseNumber) {
  if (licenseNumber == null) return true;
  const v = String(licenseNumber).trim();
  if (v === "") return true;
  return LICENSE_PLACEHOLDER_LEAD_RE.test(v);
}

function extractLicenseNumberFromConfig(configContent) {
  if (!configContent) return "";
  const m = configContent.match(/"licenseNumber"\s*:\s*"([^"]*)"/);
  return m ? m[1].trim() : "";
}

function shouldSuppressLicenseNonNegotiable(configContent) {
  const licenseNumber = extractLicenseNumberFromConfig(configContent);
  return isPlaceholderLicenseLead(licenseNumber);
}

function evaluateLicenseNoRawPlaceholder(html) {
  // Scan user-visible HTML for raw `x{4,}` or `0{4,}` substrings. Board's
  // rule: "no raw placeholders, period" — applies anywhere in body, including
  // inside `data-placeholder-slot="license"` regions (the labeled-pending
  // markup uses the literal text "License verification pending", not raw x's).
  const visible = stripScriptsAndStyles(html);
  const hits = [];
  const xRe = /x{4,}/gi;
  let m;
  while ((m = xRe.exec(visible)) !== null) {
    hits.push({ substring: m[0], index: m.index });
    if (hits.length >= 5) break;
  }
  const zRe = /0{4,}/g;
  while ((m = zRe.exec(visible)) !== null) {
    hits.push({ substring: m[0], index: m.index });
    if (hits.length >= 5) break;
  }
  if (hits.length === 0) {
    return { passed: true, evidence: "no raw x{4,}/0{4,} substrings in rendered HTML" };
  }
  const parts = hits.slice(0, 3).map((h) => {
    const start = Math.max(0, h.index - 40);
    const end = Math.min(visible.length, h.index + h.substring.length + 40);
    const ctx = visible.slice(start, end).replace(/\s+/g, " ").trim();
    return `"${h.substring}" near "${ctx}"`;
  });
  return {
    passed: false,
    evidence: `Found raw placeholder substring(s): ${parts.join("; ")}${hits.length > 3 ? ` (+${hits.length - 3} more)` : ""}`,
  };
}

function evaluateLicenseFieldRender(html, configContent) {
  const licenseNumber = extractLicenseNumberFromConfig(configContent);
  const isPlaceholder = isPlaceholderLicenseLead(licenseNumber);
  const visible = stripScriptsAndStyles(html);
  const hasPendingLabel = visible.includes(LICENSE_PENDING_LABEL);
  const slotOpenMatch = visible.match(LICENSE_SLOT_OPEN_RE);

  if (isPlaceholder) {
    if (!hasPendingLabel) {
      return {
        passed: false,
        case: "placeholder_lead",
        evidence: `placeholder_lead: rendered HTML missing literal "${LICENSE_PENDING_LABEL}" — labeled-pending markup required (no auto-suppression per Board 2026-05-26).`,
      };
    }
    if (!slotOpenMatch) {
      return {
        passed: false,
        case: "placeholder_lead",
        evidence: `placeholder_lead: "${LICENSE_PENDING_LABEL}" rendered but data-placeholder-slot="license" attribute missing — slot marker must be preserved.`,
      };
    }
    const slotOpenTag = slotOpenMatch[0];
    const ariaMatch = slotOpenTag.match(/aria-label\s*=\s*["']([^"']*)["']/i);
    if (!ariaMatch) {
      return {
        passed: false,
        case: "placeholder_lead",
        evidence: `placeholder_lead: data-placeholder-slot="license" element has no aria-label — concept-demo disclosure required.`,
      };
    }
    const aria = ariaMatch[1];
    if (!LICENSE_AREA_DISCLOSURE_RE.test(aria)) {
      return {
        passed: false,
        case: "placeholder_lead",
        evidence: `placeholder_lead: aria-label="${aria}" does not disclose concept-demo nature (expected to contain concept|demo|pending|verification).`,
      };
    }
    return {
      passed: true,
      case: "placeholder_lead",
      evidence: `placeholder_lead: "${LICENSE_PENDING_LABEL}" + data-placeholder-slot="license" + aria-label="${aria}" all present.`,
    };
  }

  // verified_lead
  if (hasPendingLabel) {
    return {
      passed: false,
      case: "verified_lead",
      evidence: `verified_lead (licenseNumber="${licenseNumber}"): rendered HTML still contains "${LICENSE_PENDING_LABEL}" — pending label must be removed when a real license is present.`,
    };
  }
  if (!visible.includes(licenseNumber)) {
    return {
      passed: false,
      case: "verified_lead",
      evidence: `verified_lead: licenseNumber "${licenseNumber}" not in rendered HTML.`,
    };
  }
  return {
    passed: true,
    case: "verified_lead",
    evidence: `verified_lead: licenseNumber "${licenseNumber}" rendered; no "${LICENSE_PENDING_LABEL}" label present.`,
  };
}

function evaluateLicenseRender(html, configContent) {
  // Combined `license_render` family for the subIssueChecks block (VAN-131).
  // Surfaces both Class E assertions — license_no_raw_placeholder and
  // license_field_render — so VAN-96 follow-up sub-issues can be closed
  // mechanically against per-case pass/fail.
  const noRaw = evaluateLicenseNoRawPlaceholder(html);
  const fieldRender = evaluateLicenseFieldRender(html, configContent);
  const passed = noRaw.passed && fieldRender.passed;
  const summary = passed
    ? `${fieldRender.case}: license slot rendered correctly; no raw placeholders.`
    : [
        !noRaw.passed ? `license_no_raw_placeholder failed — ${noRaw.evidence}` : null,
        !fieldRender.passed ? `license_field_render (${fieldRender.case}) failed — ${fieldRender.evidence}` : null,
      ].filter(Boolean).join("; ");
  return {
    passed,
    case: fieldRender.case,
    evidence: summary,
    license_no_raw_placeholder: noRaw,
    license_field_render: fieldRender,
  };
}

function evaluateSubIssueChecks(html, configContent, fetchError) {
  if (fetchError) {
    const unreached = { passed: false, evidence: `preview unreachable: ${fetchError}` };
    return SUB_ISSUE_FAMILIES.reduce((acc, k) => (acc[k] = unreached, acc), {});
  }
  return {
    slots_present: evaluateSlotsPresent(html),
    geo_city_consistency: evaluateGeoCityConsistencyHtml(html),
    no_unsplash: evaluateNoUnsplash(html),
    brand_chrome_present: evaluateBrandChromePresent(html),
    payload_fidelity: evaluatePayloadFidelity(html, configContent),
    license_render: evaluateLicenseRender(html, configContent),
  };
}

function extractSiteConfigField(configContent, path) {
  let m = configContent;
  for (const key of path) {
    const re = new RegExp(`"${key}"\\s*:\\s*("([^"]*)"|\\{([\\s\\S]*?)\\})`);
    const hit = m.match(re);
    if (!hit) return null;
    if (hit[2] !== undefined) return hit[2];
    m = hit[3] ?? "";
  }
  return null;
}

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
  const normalizedPreview = canonicalizePreviewUrl(preview_url);
  if (!normalizedPreview.ok) {
    console.error(JSON.stringify({
      error: "decision-needed",
      reason: normalizedPreview.reason,
      preview_url,
    }));
    process.exit(2);
  }
  console.error(JSON.stringify({
    preview_url_input: normalizedPreview.input,
    preview_url_canonical: normalizedPreview.canonical,
  }));
  if (!normalizedPreview.isVercel) {
    console.error(JSON.stringify({
      error: "decision-needed",
      reason: "preview_url must point to a *.vercel.app deployment host",
      preview_url,
      canonical_preview_url: normalizedPreview.canonical,
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
  let fetchError = null;
  try {
    const res = await fetch(normalizedPreview.canonical, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "VantyxQABot/1.0" },
    });
    if (!res.ok) {
      fetchError = `HTTP ${res.status}`;
      findings.push({ level: "fail", msg: `Preview returned HTTP ${res.status}` });
    } else {
      html = await res.text();
    }
  } catch (e) {
    fetchError = e.message;
    findings.push({ level: "fail", msg: `Preview unreachable: ${e.message}` });
  }

  let checklistPassed = 0;
  let checklistTotal = NON_NEGOTIABLES.length;
  if (html) {
    const cfg = existsSync(site_config_path) ? readFileSync(site_config_path, "utf8") : "";
    const suppressLicenseNonNegotiable = shouldSuppressLicenseNonNegotiable(cfg);
    if (suppressLicenseNonNegotiable) checklistTotal -= 1;
    for (const n of NON_NEGOTIABLES) {
      if (n.id === "license" && suppressLicenseNonNegotiable) {
        findings.push({ level: "pass", msg: "License # visible (suppressed for placeholder lead; enforced by license_render)" });
        continue;
      }
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

  // VAN-124: per-sub-issue family pass/fail surfaced alongside drift_score.
  const configContentForChecks = existsSync(site_config_path) ? readFileSync(site_config_path, "utf8") : "";
  const subIssueChecks = evaluateSubIssueChecks(html, configContentForChecks, fetchError);
  const subIssueFailures = Object.entries(subIssueChecks)
    .filter(([, v]) => v && v.passed === false)
    .map(([k, v]) => ({ family: k, evidence: v.evidence }));
  for (const failure of subIssueFailures) {
    findings.push({ level: "fail", msg: `subIssueCheck ${failure.family} failed: ${failure.evidence}` });
  }

  // passes_threshold gates demo-gen's REJECT/PASS: drift_score OR any red
  // sub-issue family fails the gate so the rejection reason names the right
  // reconciliation surface, not a generic drift_score.
  const passesThreshold = driftScore <= 15 && subIssueFailures.length === 0;

  console.log(JSON.stringify({
    preview_url: normalizedPreview.canonical,
    drift_score: driftScore,
    palette_drift: paletteDrift,
    checklist_passed: `${checklistPassed}/${checklistTotal}`,
    passes_threshold: passesThreshold,
    subIssueChecks,
    subIssueFailures,
    findings,
  }));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  // Self-tests for extractBrandFilePalette
  const assert = (cond, msg) => { if (!cond) throw new Error(`FAIL: ${msg}`); };

  // 1. Canonicalization preserves hash URL host and normalizes path/query/hash.
  const canonicalWithHash = canonicalizePreviewUrl("https://preview-brandon-electric-34e92325-gqpz3lrgv-rfog88s-projects.vercel.app/some/path?x=1#frag");
  assert(canonicalWithHash.ok, "canonicalize should accept branded vercel preview URL");
  assert(canonicalWithHash.canonical === "https://preview-brandon-electric-34e92325-gqpz3lrgv-rfog88s-projects.vercel.app/", "hash URL host should be preserved");

  // 2. Canonicalization preserves second sample hash URL host.
  const canonicalCollier = canonicalizePreviewUrl("https://preview-collier-electric-5ceba4a2-kqufs8t3d-rfog88s-projects.vercel.app/");
  assert(canonicalCollier.ok, "canonicalize should accept second sample preview URL");
  assert(canonicalCollier.canonical === "https://preview-collier-electric-5ceba4a2-kqufs8t3d-rfog88s-projects.vercel.app/", "second sample hash URL host should be preserved");

  // 3. Bare preview alias is rejected to prevent alias contamination checks.
  const canonicalBare = canonicalizePreviewUrl("https://preview-dunedin-electric-co.vercel.app/");
  assert(!canonicalBare.ok, "canonicalize should reject bare preview alias");
  assert(
    canonicalBare.reason.includes("canonical hash deployment URL"),
    "bare preview alias rejection reason should mention canonical hash URL"
  );

  // 1. Table row beats inline prose
  assert(
    extractBrandFilePalette("accent: #ffffff\n| accent | `#c22d26` |").accent === "#c22d26",
    "table row should beat inline prose"
  );

  // 2. No table: returns LAST inline occurrence
  assert(
    extractBrandFilePalette("accent: #aaaaaa\naccent: #bbbbbb").accent === "#bbbbbb",
    "no table: should return last inline"
  );

  // 3. Single inline still works
  assert(
    extractBrandFilePalette("accent: #abcdef").accent === "#abcdef",
    "single inline should still match"
  );

  console.error("Self-tests passed.");
}

const isDirectInvocation = process.argv[1]
  && import.meta.url === new URL(process.argv[1], "file:").href;

if (isDirectInvocation) {
  main().catch((e) => {
    console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
    process.exit(1);
  });
}
