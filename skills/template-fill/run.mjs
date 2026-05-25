#!/usr/bin/env node
// template-fill — write site.config.ts in a Vantyx Web OS clone, merging
// SQLite lead row + per-client brand file + agency-brand fallbacks.
//
// Also resolves Google Business Profile (GBP) media + reviews via the
// Places API (New) when the lead has a `gmaps_place_id` and the env carries
// GOOGLE_PLACES_API_KEY (IP-restricted to the droplet per VAN-37 board
// provision). Results are cached on the lead row so we are not re-billing
// Places API on every rebuild.
//
// Invocation:
//   node skills/template-fill/run.mjs --lead-id <uuid> --clone-path /tmp/demos/<slug> --client-slug <slug> \
//     [--force-gbp-fetch] [--skip-gbp-fetch] [--brand-fallback-image <url>]

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// GBP photo cache TTL — refetch once a week. Places photo URIs are stable
// for ~1h per the docs, so we cache the resolved photoUri (not the photo
// resource name) and accept periodic refresh churn.
const GBP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GBP_PHOTO_TARGET = 4;          // 1 hero + 3 gallery slots
const GBP_REVIEW_TARGET = 6;         // pull up to 6, render up to 3 per VAN-37 acceptance
const GBP_PHOTO_MAX_WIDTH = 1600;    // hero needs ~1600px wide
const PLACES_API_BASE = "https://places.googleapis.com/v1";
const VANTYX_BRAND_FALLBACK_IMAGE =
  process.env.VANTYX_BRAND_FALLBACK_IMAGE_URL ||
  "https://vantyx.com/brand/hero-fallback.jpg";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  console.error(JSON.stringify({
    error: "adapter-broken",
    reason: "node_sqlite_unavailable",
    detail: "Bind NODE_OPTIONS=--experimental-sqlite at project or agent env level.",
    message: e.message,
  }));
  process.exit(3);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

// Niche defaults — must match brand-extract's defaultPaletteByNiche.
const NICHE_PALETTE = {
  electrician: { primary: "#0F172A", accent: "#FACC15", bg: "#FFFFFF", text: "#111827", muted: "#6B7280" },
  plumber:     { primary: "#0B3D91", accent: "#FFFFFF", bg: "#FFFFFF", text: "#111827", muted: "#6B7280" },
  hvac:        { primary: "#0F172A", accent: "#DC2626", bg: "#FFFFFF", text: "#111827", muted: "#6B7280" },
  roofer:      { primary: "#3F2A1A", accent: "#D97706", bg: "#FAFAF7", text: "#1C1917", muted: "#78716C" },
  gc:          { primary: "#1F2937", accent: "#F59E0B", bg: "#FFFFFF", text: "#111827", muted: "#6B7280" },
};

const NICHE_SERVICES = {
  electrician: [
    { title: "Panel Upgrades", description: "100A → 200A service upgrades, code-compliant in a day.", icon: "Zap" },
    { title: "EV Chargers", description: "Level 2 home charger installs.", icon: "BatteryCharging" },
    { title: "Whole-Home Rewiring", description: "Old houses, modern code.", icon: "Cable" },
    { title: "Generator Hookups", description: "Standby + portable. Transfer switches done right.", icon: "Power" },
    { title: "Lighting & Fans", description: "Recessed, pendants, ceiling fans, outdoor.", icon: "Lightbulb" },
    { title: "Emergency Calls", description: "Outage, sparking outlet, burning smell? Same-day.", icon: "AlertTriangle" },
  ],
  plumber: [
    { title: "Drain Cleaning", description: "Hydro-jetting, camera inspection, root removal.", icon: "Droplets" },
    { title: "Water Heater Install", description: "Tank + tankless. Same-day swaps.", icon: "Thermometer" },
    { title: "Leak Detection", description: "Slab leaks, pipe leaks, hidden moisture.", icon: "Search" },
    { title: "Sewer Line Repair", description: "Trenchless replacement when possible.", icon: "Wrench" },
    { title: "Fixture Installation", description: "Faucets, toilets, garbage disposals.", icon: "Settings" },
    { title: "24/7 Emergency", description: "Burst pipes, no hot water, sewer backups.", icon: "AlertTriangle" },
  ],
  hvac: [
    { title: "AC Install & Repair", description: "Central + ductless. Brands we trust.", icon: "Snowflake" },
    { title: "Furnace Service", description: "Annual tune-ups, repair, replacement.", icon: "Flame" },
    { title: "Heat Pumps", description: "Modern, efficient year-round comfort.", icon: "Zap" },
    { title: "Indoor Air Quality", description: "Filtration, humidification, UV.", icon: "Wind" },
    { title: "Ductwork", description: "Inspection, sealing, replacement.", icon: "Cable" },
    { title: "24/7 Emergency", description: "No heat in January, no AC in July.", icon: "AlertTriangle" },
  ],
  roofer: [
    { title: "Roof Replacement", description: "Asphalt, metal, flat. Lifetime warranties.", icon: "Home" },
    { title: "Storm & Hail Damage", description: "Insurance claim assistance.", icon: "Cloud" },
    { title: "Leak Repair", description: "Same-day callbacks. We find the source.", icon: "Droplets" },
    { title: "Gutters & Downspouts", description: "Seamless install, guards, repair.", icon: "GitBranch" },
    { title: "Skylights", description: "Install, replacement, leak repair.", icon: "Sun" },
    { title: "Free Inspections", description: "Drone-assisted, photo report included.", icon: "Eye" },
  ],
  gc: [
    { title: "Kitchen Remodel", description: "Full design-build, on time, on budget.", icon: "ChefHat" },
    { title: "Bathroom Remodel", description: "From cosmetic refresh to full rebuild.", icon: "Bath" },
    { title: "Additions", description: "Second story, mother-in-law, garage conversion.", icon: "Plus" },
    { title: "Deck & Patio", description: "Composite, hardwood, stone.", icon: "TreePine" },
    { title: "Whole-Home Renovations", description: "From foundation up. We handle permits.", icon: "Hammer" },
    { title: "Custom Builds", description: "Lot to keys. Architect partnerships available.", icon: "Home" },
  ],
};

function openDb() {
  const path = process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite";
  return new DatabaseSync(path);
}

function readClientBrandFile(slug) {
  const p = resolve(repoRoot, "shared", "brand", "clients", `${slug}.md`);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

function extractPaletteFromBrandFile(md) {
  if (!md) return null;
  // Look for "Primary: #xxxxxx" style lines.
  const grab = (label) => {
    const m = md.match(new RegExp(`${label}\\s*[:=]?\\s*[\`'"]?(#(?:[0-9a-f]{3}|[0-9a-f]{6}))`, "i"));
    return m ? m[1].toLowerCase() : null;
  };
  const primary = grab("Primary");
  const accent = grab("Accent");
  const bg = grab("Background") || grab("Bg");
  const text = grab("Text");
  const muted = grab("Muted");
  if (!primary && !accent) return null;
  return { primary, accent, bg, text, muted };
}

function extractFontsFromBrandFile(md) {
  if (!md) return null;
  const headings = md.match(/Headings?\s*[:=]?\s*[`'"]?([A-Za-z][^,\n`'"\)]{1,40})/i)?.[1]?.trim();
  const body = md.match(/Body\s*[:=]?\s*[`'"]?([A-Za-z][^,\n`'"\)]{1,40})/i)?.[1]?.trim();
  if (!headings && !body) return null;
  return { headings, body };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "lead-id": { type: "string" },
      "clone-path": { type: "string" },
      "client-slug": { type: "string" },
      "force-gbp-fetch": { type: "boolean", default: false },
      "skip-gbp-fetch": { type: "boolean", default: false },
      "brand-fallback-image": { type: "string" },
    },
  });

  const leadId = values["lead-id"];
  const clonePath = values["clone-path"];
  const slug = values["client-slug"];
  const forceGbp = !!values["force-gbp-fetch"];
  const skipGbp = !!values["skip-gbp-fetch"];
  const brandFallback = values["brand-fallback-image"] || VANTYX_BRAND_FALLBACK_IMAGE;

  if (!leadId || !clonePath || !slug) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "missing required arg(s)", got: { leadId, clonePath, slug } }));
    process.exit(2);
  }
  if (!existsSync(clonePath) || !statSync(clonePath).isDirectory()) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "clone-path missing or not a directory", clonePath }));
    process.exit(2);
  }

  const db = openDb();
  let lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);

  if (!lead) {
    db.close();
    console.error(JSON.stringify({ error: "decision-needed", reason: "lead-id not found", leadId }));
    process.exit(2);
  }

  const warnings = [];
  const gbpDiagnostics = { attempted: false, cached: false, skipped: null, reviewsFetched: 0, photosFetched: 0, errors: [] };

  // GBP fetch — populate testimonials/gallery/hero cache if eligible.
  if (skipGbp) {
    gbpDiagnostics.skipped = "skip-gbp-fetch flag set";
  } else if (!lead.gmaps_place_id) {
    gbpDiagnostics.skipped = "lead has no gmaps_place_id";
    warnings.push("no gmaps_place_id on lead — GBP media skipped");
  } else if (!process.env.GOOGLE_PLACES_API_KEY) {
    gbpDiagnostics.skipped = "GOOGLE_PLACES_API_KEY not in env";
    warnings.push("GOOGLE_PLACES_API_KEY not bound in env — using cached GBP only");
  } else if (!forceGbp && isCacheFresh(lead.gbp_photos_cache_at)) {
    gbpDiagnostics.cached = true;
    gbpDiagnostics.skipped = "cache fresh (<7d)";
  } else {
    gbpDiagnostics.attempted = true;
    try {
      const result = await fetchGbpAndCache(db, lead);
      gbpDiagnostics.reviewsFetched = result.reviewCount;
      gbpDiagnostics.photosFetched = result.photoCount;
      // Re-read the lead row to pick up the freshly-cached columns.
      lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);
    } catch (e) {
      gbpDiagnostics.errors.push(e?.message || String(e));
      warnings.push(`GBP fetch failed: ${e?.message || e}`);
    }
  }

  db.close();

  const niche = lead.niche || "gc";
  const services = NICHE_SERVICES[niche] || NICHE_SERVICES.gc;

  // Resolve palette + fonts
  const clientBrandMd = readClientBrandFile(slug);
  let palette = extractPaletteFromBrandFile(clientBrandMd);
  if (!palette || !palette.primary) {
    warnings.push("client brand file missing palette — used niche defaults");
    palette = NICHE_PALETTE[niche] || NICHE_PALETTE.gc;
  } else {
    // Fill any gaps from niche defaults
    const defaults = NICHE_PALETTE[niche] || NICHE_PALETTE.gc;
    palette = { ...defaults, ...Object.fromEntries(Object.entries(palette).filter(([, v]) => v)) };
  }
  const fonts = extractFontsFromBrandFile(clientBrandMd) || { headings: "Inter, system-ui, sans-serif", body: "Inter, system-ui, sans-serif" };

  // Compose site.config.ts
  const cityName = lead.city || "your area";

  // Parse cached JSON columns (VAN-42) + GBP cache (VAN-54).
  const testimonials = safeParseArray(lead.testimonials, "testimonials");
  const gallery = safeParseArray(lead.gallery, "gallery");
  const serviceAreaZips = safeParseArray(lead.service_area_zips, "service_area_zips");

  // Hero fallback chain: GBP cover → in-house Vantyx brand image → hard-fail.
  // Stock photos are never acceptable (VAN-54 acceptance, VAN-37 parent).
  let heroImage = null;
  let heroSource = null;
  if (lead.gbp_hero_url) {
    heroImage = lead.gbp_hero_url;
    heroSource = "gbp";
  } else if (brandFallback) {
    heroImage = brandFallback;
    heroSource = "vantyx-brand-fallback";
    warnings.push(`hero using Vantyx brand fallback (no GBP cover available)`);
  } else {
    console.error(JSON.stringify({
      error: "decision-needed",
      reason: "hero-unresolvable",
      detail: "No GBP cover photo cached and no --brand-fallback-image / VANTYX_BRAND_FALLBACK_IMAGE_URL set. Stock photos are not permitted (VAN-54).",
      gbpDiagnostics,
    }));
    process.exit(2);
  }

  const config = {
    business: {
      name: lead.name || "Your Business",
      legalName: lead.name || "Your Business",
      tagline: lead.tagline || undefined,
      licenseNumber: lead.license_no || undefined,
      insurance: undefined,
      bbb: { accredited: false },
      foundedYear: undefined,
      googlePlaceId: lead.gmaps_place_id || undefined,
    },
    contact: {
      phone: lead.phone ? formatPhone(lead.phone) : "(555) 555-5555",
      email: lead.email || `hello@${slug}.com`,
      address: {
        street: "Service area listed below",
        city: lead.city || "Lima",
        state: lead.state || "OH",
        zip: lead.zip || "45801",
      },
      hours: {
        mon: "7:00 AM – 6:00 PM",
        tue: "7:00 AM – 6:00 PM",
        wed: "7:00 AM – 6:00 PM",
        thu: "7:00 AM – 6:00 PM",
        fri: "7:00 AM – 6:00 PM",
        sat: "8:00 AM – 2:00 PM",
        sun: "Closed",
      },
      emergency24_7: niche === "plumber" || niche === "hvac" || niche === "electrician",
    },
    serviceArea: {
      zips: serviceAreaZips.length ? serviceAreaZips : [lead.zip || "45801"],
      hqLatLng: [40.7426, -84.1052],   // Lima default; brand-extract may override Phase 2
      radiusMiles: 50,
    },
    services,
    gallery,
    branding: {
      palette,
      fonts,
    },
    hero: {
      image: heroImage,
      imageSource: heroSource,
      service: nicheLabel(niche),
      city: `${cityName}, ${lead.state || "OH"}`,
      subhead: lead.gmaps_rating
        ? `${lead.gmaps_rating}★ rated, locally owned, licensed and insured.`
        : "Locally owned, licensed and insured.",
    },
    financing: niche === "roofer" || niche === "hvac" ? { enabled: true } : { enabled: false },
    testimonials,
  };

  const fileBody = renderConfigFile(config, lead, slug, warnings);
  const target = resolve(clonePath, "site.config.ts");
  writeFileSync(target, fileBody, "utf8");

  console.log(JSON.stringify({
    wrote: target,
    bytes: Buffer.byteLength(fileBody, "utf8"),
    warnings,
    gbp: gbpDiagnostics,
    heroSource,
  }));
}

function safeParseArray(value, label) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    console.error(`[template-fill] WARN: ${label} column contained non-JSON value; treating as empty`);
    return [];
  }
}

function isCacheFresh(iso) {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < GBP_CACHE_TTL_MS;
}

// Fetch reviews + photos via Places API (New), resolve photo media URIs,
// persist into the lead row (testimonials, gallery, gbp_hero_url,
// gbp_photos_cache_at). Throws on network/HTTP failure so the caller can
// record diagnostics. Caller is responsible for db lifecycle.
async function fetchGbpAndCache(db, lead) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY missing");
  const placeId = lead.gmaps_place_id;
  if (!placeId) throw new Error("lead.gmaps_place_id missing");

  // 1) place details — reviews + photos
  const detailUrl = `${PLACES_API_BASE}/places/${encodeURIComponent(placeId)}?fields=displayName,reviews,photos,id`;
  const detailRes = await fetch(detailUrl, {
    headers: { "X-Goog-Api-Key": apiKey, "Accept": "application/json" },
  });
  if (!detailRes.ok) {
    const body = await safeReadText(detailRes);
    throw new Error(`places.details ${detailRes.status}: ${body.slice(0, 400)}`);
  }
  const detail = await detailRes.json();

  const reviewsRaw = Array.isArray(detail.reviews) ? detail.reviews.slice(0, GBP_REVIEW_TARGET) : [];
  const testimonials = reviewsRaw.map((r) => ({
    author: r?.authorAttribution?.displayName || "Verified Google review",
    location: undefined,
    body: (r?.text?.text || r?.originalText?.text || "").trim(),
    rating: typeof r?.rating === "number" ? r.rating : undefined,
    publishedAt: r?.publishTime || undefined,
    source: "gbp",
  })).filter((t) => t.body.length > 0);

  // 2) photo media — resolve up to GBP_PHOTO_TARGET URIs
  const photoEntries = Array.isArray(detail.photos) ? detail.photos.slice(0, GBP_PHOTO_TARGET) : [];
  const resolvedPhotoUris = [];
  for (const p of photoEntries) {
    if (!p?.name) continue;
    const mediaUrl = `${PLACES_API_BASE}/${p.name}/media?maxWidthPx=${GBP_PHOTO_MAX_WIDTH}&skipHttpRedirect=true`;
    const mediaRes = await fetch(mediaUrl, {
      headers: { "X-Goog-Api-Key": apiKey, "Accept": "application/json" },
    });
    if (!mediaRes.ok) {
      const body = await safeReadText(mediaRes);
      throw new Error(`places.media ${mediaRes.status} for ${p.name}: ${body.slice(0, 300)}`);
    }
    const mediaJson = await mediaRes.json();
    if (mediaJson?.photoUri) resolvedPhotoUris.push(mediaJson.photoUri);
  }

  const gbpHeroUrl = resolvedPhotoUris[0] || null;
  // Gallery slot shape (per VAN-42 migration): { before, after, caption? }.
  // GBP gives us single photos, not before/after pairs. We populate `after`
  // (the "result" slot) and leave `before` null; the renderer falls back to
  // a single-image gallery card. This matches VAN-50's gallery slot count
  // of up to 3 and respects the "never stock" rule.
  const galleryRows = resolvedPhotoUris.slice(1).map((url) => ({
    before: null,
    after: url,
    caption: undefined,
    source: "gbp",
  }));

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE leads
    SET
      testimonials = ?,
      gallery = ?,
      gbp_hero_url = ?,
      gbp_photos_cache_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(testimonials),
    JSON.stringify(galleryRows),
    gbpHeroUrl,
    now,
    now,
    lead.id,
  );

  return {
    reviewCount: testimonials.length,
    photoCount: resolvedPhotoUris.length,
    heroUrl: gbpHeroUrl,
  };
}

async function safeReadText(res) {
  try { return await res.text(); } catch { return ""; }
}

function formatPhone(raw) {
  const d = String(raw).replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}

function nicheLabel(n) {
  return { electrician: "Electrician", plumber: "Plumber", hvac: "HVAC", roofer: "Roofer", gc: "General Contractor" }[n] || "Contractor";
}

export function renderConfigFile(config, lead, slug, warnings) {
  const header = [
    `// Auto-generated by Vantyx template-fill skill.`,
    `// Lead: ${lead.name} (id=${lead.id})`,
    `// Slug: ${slug}`,
    `// Generated: ${new Date().toISOString()}`,
    warnings.length ? `// Warnings: ${warnings.join("; ")}` : null,
  ].filter(Boolean).join("\n");

  return `${header}

import type { SiteConfig } from "@/lib/site-config";

export const siteConfig: SiteConfig = ${JSON.stringify(config, null, 2)};
`;
}

// Only auto-run when invoked directly (allows tests to import renderConfigFile).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
    process.exit(1);
  });
}
