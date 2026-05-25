#!/usr/bin/env node
/**
 * Vantyx template-fill — deterministic writer for `site.config.ts`.
 *
 * Replaces the prior model-driven file write that kept emitting hallucinated
 * imports (`from "./site.config"`). The model is now out of the file-write
 * path entirely: lead row + brand markdown → `site.config.ts` via straight
 * string interpolation, never via an LLM.
 *
 * Owns VAN-13 acceptance criteria.
 *
 * Usage:
 *   node run.mjs --lead-id <id> --brand-file <path> --template-dir <path>
 *                [--leads-db <path>] [--enrichment-json <path>]
 *                [--dry-run] [--out <path>]
 *
 *   node run.mjs --lead-json <path> --brand-file <path> --template-dir <path>
 *                [...]
 *
 * Exit codes:
 *   0  — wrote site.config.ts, all invariants hold
 *   1  — CLI / IO error (missing arg, unreadable file)
 *   2  — lead not found / lead row missing required fields
 *   3  — brand file unparseable
 *   4  — post-write invariant check failed (should be impossible — bug if hit)
 *   5  — one or more --require fields resolved empty (VAN-42 hard-fail)
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ISO_NOW = new Date().toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// Niche-default services (mirrors the Lima template defaults; brand files
// note "no services list — defaulting to the standard electrician 6-pack").
// Keyed by niche; if a niche is missing, falls back to electrician.
// ─────────────────────────────────────────────────────────────────────────────

const NICHE_DEFAULTS = {
  electrician: {
    serviceCopy: "Electrician",
    emergency24_7: true,
    services: [
      { title: "Panel Upgrades",       description: "100A → 200A service upgrades, code-compliant in a day.", icon: "Zap" },
      { title: "EV Chargers",          description: "Level 2 home charger installs.",                          icon: "BatteryCharging" },
      { title: "Whole-Home Rewiring",  description: "Old houses, modern code.",                                icon: "Cable" },
      { title: "Generator Hookups",    description: "Standby + portable. Transfer switches done right.",       icon: "Power" },
      { title: "Lighting & Fans",      description: "Recessed, pendants, ceiling fans, outdoor.",              icon: "Lightbulb" },
      { title: "Emergency Calls",      description: "Outage, sparking outlet, burning smell? Same-day.",       icon: "AlertTriangle" },
    ],
  },
  plumber: {
    serviceCopy: "Plumber",
    emergency24_7: true,
    services: [
      { title: "Drain Cleaning",       description: "Hydro-jetting and snaking. Same-day clears.",            icon: "Wrench" },
      { title: "Water Heaters",        description: "Tank and tankless installs and repairs.",                icon: "Droplet" },
      { title: "Repiping",             description: "Galvanized → PEX whole-home repipes.",                   icon: "Pipette" },
      { title: "Leak Detection",       description: "Non-invasive electronic leak location.",                 icon: "Search" },
      { title: "Sewer Line",           description: "Camera inspection, trenchless repair.",                  icon: "GitBranch" },
      { title: "Emergency Service",    description: "Burst pipe, flooded basement? 24/7.",                    icon: "AlertTriangle" },
    ],
  },
  hvac: {
    serviceCopy: "HVAC Contractor",
    emergency24_7: true,
    services: [
      { title: "AC Repair",            description: "Diagnostics, refrigerant, compressor.",                  icon: "Wind" },
      { title: "Furnace Install",      description: "High-efficiency gas, oil, electric.",                    icon: "Flame" },
      { title: "Heat Pumps",           description: "Air-source and ductless mini-splits.",                   icon: "Thermometer" },
      { title: "Duct Cleaning",        description: "NADCA-certified whole-system cleans.",                   icon: "Fan" },
      { title: "Maintenance Plans",    description: "Spring/fall tune-ups, priority service.",                icon: "CalendarCheck" },
      { title: "Emergency HVAC",       description: "No heat, no AC? Same-day response.",                     icon: "AlertTriangle" },
    ],
  },
  roofer: {
    serviceCopy: "Roofer",
    emergency24_7: false,
    services: [
      { title: "Asphalt Shingle",      description: "Architectural and 3-tab installs and replacements.",     icon: "Home" },
      { title: "Metal Roofing",        description: "Standing seam, exposed-fastener.",                       icon: "Layers" },
      { title: "Storm Damage",         description: "Insurance claim assistance, free inspections.",          icon: "Cloud" },
      { title: "Gutter Install",       description: "Seamless aluminum, leaf guards.",                        icon: "Pipe" },
      { title: "Skylights",            description: "Velux solar and manual install/replace.",                icon: "Sun" },
      { title: "Roof Repair",          description: "Leaks, missing shingles, flashing.",                     icon: "Wrench" },
    ],
  },
  gc: {
    serviceCopy: "General Contractor",
    emergency24_7: false,
    services: [
      { title: "Kitchen Remodels",     description: "Full design-build kitchens.",                            icon: "ChefHat" },
      { title: "Bath Remodels",        description: "Master and guest baths, walk-in showers.",               icon: "Bath" },
      { title: "Additions",            description: "Room additions, second-story builds.",                   icon: "Plus" },
      { title: "Basement Finish",      description: "Egress, framing, electrical, drywall.",                  icon: "ArrowDownToLine" },
      { title: "Decks & Patios",       description: "Composite, pressure-treated, stone.",                    icon: "Square" },
      { title: "Whole-Home",           description: "Full gut renovations.",                                  icon: "Hammer" },
    ],
  },
};

// State → niche-default metro for hero/contact city when lead.city is missing
// or holds a street address. Aligned with plan Section 3 target metros.
const STATE_DEFAULT_CITY = {
  OH: "Lima",
  IN: "Indianapolis",
  MI: "Detroit",
  PA: "Pittsburgh",
  KY: "Louisville",
  WV: "Charleston",
  IL: "Chicago",
  WI: "Milwaukee",
};

// State → fallback HQ coords (state capital or major metro). Used when we
// can't geocode the lead's zip. Inaccurate by miles, fine for a hero map.
const STATE_FALLBACK_COORDS = {
  OH: [40.7426, -84.1052],  // Lima
  IN: [39.7684, -86.1581],  // Indianapolis
  MI: [42.3314, -83.0458],  // Detroit
  PA: [40.4406, -79.9959],  // Pittsburgh
  KY: [38.2527, -85.7585],  // Louisville
  WV: [38.3498, -81.6326],  // Charleston
  IL: [41.8781, -87.6298],  // Chicago
  WI: [43.0389, -87.9065],  // Milwaukee
};

const VANTYX_FALLBACK_PALETTE = {
  primary: "#0F172A",
  accent:  "#FACC15",
  bg:      "#FFFFFF",
  text:    "#111827",
  muted:   "#6B7280",
};

const VANTYX_FALLBACK_FONTS = {
  headings: "Inter, system-ui, sans-serif",
  body:     "Inter, system-ui, sans-serif",
};

const DEFAULT_HOURS = {
  mon: "7:00 AM – 6:00 PM",
  tue: "7:00 AM – 6:00 PM",
  wed: "7:00 AM – 6:00 PM",
  thu: "7:00 AM – 6:00 PM",
  fri: "7:00 AM – 6:00 PM",
  sat: "8:00 AM – 2:00 PM",
  sun: "Closed",
};

const DEFAULT_HERO_IMAGE =
  "https://images.unsplash.com/photo-1581094288338-2314dddb7ece?w=1920&q=80";

// ─────────────────────────────────────────────────────────────────────────────
// CLI parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function die(code, msg) {
  console.error(`template-fill: ${msg}`);
  process.exit(code);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead loading
// ─────────────────────────────────────────────────────────────────────────────

function loadLeadFromDb(dbPath, leadId) {
  if (!existsSync(dbPath)) die(1, `leads-db not found: ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db
    .prepare(
      `SELECT id, name, phone, email, website, niche, city, state, zip,
              gmaps_rating, review_count, score, stage, demo_url,
              license_no, service_area_zips, testimonials, gallery, tagline
       FROM leads WHERE id = ?`,
    )
    .get(leadId);
  db.close();
  if (!row) die(2, `lead not found: ${leadId}`);
  return row;
}

function loadLeadFromJson(path) {
  if (!existsSync(path)) die(1, `lead-json not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    die(1, `lead-json parse error: ${e.message}`);
  }
}

function requireLeadFields(lead) {
  const missing = ["id", "name", "niche"].filter((k) => !lead[k]);
  if (missing.length) die(2, `lead missing required fields: ${missing.join(", ")}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Brand-markdown parsing — deterministic, regex-driven
// ─────────────────────────────────────────────────────────────────────────────

function parseBrandFile(brandPath, warnings) {
  if (!brandPath) {
    warnings.push("no brand file supplied — used niche defaults");
    return { palette: VANTYX_FALLBACK_PALETTE, fonts: VANTYX_FALLBACK_FONTS };
  }
  if (!existsSync(brandPath)) {
    warnings.push(`brand file not found at ${brandPath} — used niche defaults`);
    return { palette: VANTYX_FALLBACK_PALETTE, fonts: VANTYX_FALLBACK_FONTS };
  }
  const md = readFileSync(brandPath, "utf8");
  return { palette: parsePalette(md, warnings), fonts: parseFonts(md, warnings) };
}

function parsePalette(md, warnings) {
  // Looks for markdown rows like:
  //   | primary | `#0F172A` | Header, footer, ...
  // Each token is optional; falls back to Vantyx default per missing token.
  const result = { ...VANTYX_FALLBACK_PALETTE };
  const tokens = ["primary", "accent", "bg", "text", "muted"];
  let found = 0;
  for (const tok of tokens) {
    const re = new RegExp(
      `\\|\\s*${tok}\\s*\\|\\s*\`?(#[0-9A-Fa-f]{3,8})\`?\\s*\\|`,
      "i",
    );
    const m = md.match(re);
    if (m) {
      result[tok] = m[1];
      found++;
    }
  }
  if (found === 0) warnings.push("client brand file missing palette table — used Vantyx defaults");
  else if (found < tokens.length) warnings.push(`client brand file palette had ${found}/${tokens.length} tokens — filled gaps with Vantyx defaults`);
  return result;
}

function parseFonts(md, warnings) {
  // Looks for `- **Headings**: \`Inter\`, weight 700` style lines.
  const headM = md.match(/\*\*Headings?\*\*[:\s]*`?([A-Za-z][\w \-]{0,40})`?/i);
  const bodyM = md.match(/\*\*Body\*\*[:\s]*`?([A-Za-z][\w \-]{0,40})`?/i);
  const fallback = "system-ui, sans-serif";
  const headings = headM ? `${headM[1].trim()}, ${fallback}` : VANTYX_FALLBACK_FONTS.headings;
  const body     = bodyM ? `${bodyM[1].trim()}, ${fallback}` : VANTYX_FALLBACK_FONTS.body;
  if (!headM && !bodyM) warnings.push("client brand file missing typography section — used Vantyx defaults");
  return { headings, body };
}

// ─────────────────────────────────────────────────────────────────────────────
// Address normalization — gmaps-scrape often dumps street into `city`
// ─────────────────────────────────────────────────────────────────────────────

const STREET_SUFFIX_RE = /\b(St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Hwy|Highway|Sq|Suite|Ste)\b\.?/i;

function looksLikeStreet(s) {
  if (!s) return false;
  return /^\s*\d/.test(s) || STREET_SUFFIX_RE.test(s);
}

function normalizeAddress(lead, warnings) {
  const rawCity = lead.city || "";
  const state = (lead.state || "").trim();
  const zip = (lead.zip || "").trim();

  if (looksLikeStreet(rawCity)) {
    const fallbackCity = STATE_DEFAULT_CITY[state] || state || "Service Area";
    warnings.push(`lead.city ("${rawCity}") looks like a street address — moved to street, used niche-default city "${fallbackCity}"`);
    return { street: rawCity.trim(), city: fallbackCity, state, zip };
  }
  if (!rawCity) {
    const fallbackCity = STATE_DEFAULT_CITY[state] || state || "Service Area";
    warnings.push(`lead.city is empty — used niche-default city "${fallbackCity}"`);
    return { street: "Service area listed below", city: fallbackCity, state, zip };
  }
  return { street: "Service area listed below", city: rawCity.trim(), state, zip };
}

// ─────────────────────────────────────────────────────────────────────────────
// Slug
// ─────────────────────────────────────────────────────────────────────────────

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone formatting
// ─────────────────────────────────────────────────────────────────────────────

function formatPhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return String(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero subhead — uses gmaps_rating if present
// ─────────────────────────────────────────────────────────────────────────────

function heroSubhead(lead) {
  const rating = Number(lead.gmaps_rating);
  if (Number.isFinite(rating) && rating > 0) {
    return `${rating.toFixed(1)}★ rated, locally owned, licensed and insured.`;
  }
  return "Locally owned, licensed and insured.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe JSON parse — leads columns are TEXT-encoded JSON. Empty / unparseable
// falls back to [] rather than throwing, since these fields are best-effort
// data that may be missing on freshly-scraped rows.
// ─────────────────────────────────────────────────────────────────────────────

function safeJsonArray(raw, field, warnings) {
  if (raw == null || raw === "") return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v;
    warnings.push(`lead.${field} parsed to non-array — ignored`);
    return [];
  } catch (e) {
    warnings.push(`lead.${field} unparseable JSON — ignored (${e.message})`);
    return [];
  }
}

// Map VAN-42's `{ author, location?, body, rating? }` testimonial onto the
// legacy SiteConfig shape `{ author, quote, rating }` while preserving the
// new optional `body`/`location` keys. Writer emits both shapes so existing
// consumers (e.g. GoogleReviewsEmbed) keep reading `quote` / `rating`.
function mapTestimonial(t) {
  const body = t.body || t.quote || "";
  return {
    author: t.author || "",
    quote: body,
    rating: typeof t.rating === "number" ? t.rating : 5,
    ...(body ? { body } : {}),
    ...(t.location ? { location: t.location } : {}),
  };
}

// Map VAN-42's `{ before, after, caption? }` gallery item onto the legacy
// SiteConfig shape `{ src, alt, type }` while preserving the new keys.
// The "after" URL becomes the primary `src` so the existing renderer shows
// the finished work; `caption` (or "Before / after") becomes `alt`.
function mapGalleryItem(g) {
  const src = g.after || g.src || g.before || "";
  const alt = g.caption || g.alt || (g.before && g.after ? "Before / after" : "");
  return {
    src,
    alt,
    type: g.type || (g.before && g.after ? "before-after" : "project"),
    ...(g.before ? { before: g.before } : {}),
    ...(g.after ? { after: g.after } : {}),
    ...(g.caption ? { caption: g.caption } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the SiteConfig object
// ─────────────────────────────────────────────────────────────────────────────

function buildSiteConfig({ lead, brand, enrichment, warnings }) {
  const niche = (lead.niche || "electrician").toLowerCase();
  const niche_defaults = NICHE_DEFAULTS[niche] || NICHE_DEFAULTS.electrician;
  if (!NICHE_DEFAULTS[niche]) warnings.push(`unknown niche "${niche}" — used electrician defaults`);

  const slug = slugify(lead.name);
  const addr = normalizeAddress(lead, warnings);
  const phone = formatPhone(lead.phone);
  const email = lead.email || `hello@${slug}.com`;
  const hqLatLng = STATE_FALLBACK_COORDS[addr.state] || STATE_FALLBACK_COORDS.OH;

  const en = enrichment || {};

  // VAN-42 precedence: enrichment JSON overrides DB row, DB row overrides
  // implicit fallback. Enrichment is hand-curated and shipped without a DB
  // write, so it always wins.
  const licenseNumber = en.licenseNumber || lead.license_no || "";
  const tagline = en.tagline || lead.tagline || "";

  const dbZips = safeJsonArray(lead.service_area_zips, "service_area_zips", warnings)
    .map((z) => String(z).trim())
    .filter(Boolean);
  const enZips = Array.isArray(en.serviceAreaZips)
    ? en.serviceAreaZips.map((z) => String(z).trim()).filter(Boolean)
    : [];
  const zips = enZips.length
    ? enZips
    : dbZips.length
      ? dbZips
      : (addr.zip ? [addr.zip] : []);

  const dbTestimonials = safeJsonArray(lead.testimonials, "testimonials", warnings);
  const enTestimonials = Array.isArray(en.testimonials) ? en.testimonials : null;
  const testimonials = (enTestimonials && enTestimonials.length
    ? enTestimonials
    : dbTestimonials
  ).map(mapTestimonial);

  const dbGallery = safeJsonArray(lead.gallery, "gallery", warnings);
  const enGallery = Array.isArray(en.gallery) ? en.gallery : null;
  const gallery = (enGallery && enGallery.length ? enGallery : dbGallery).map(mapGalleryItem);

  return {
    business: {
      name: lead.name,
      legalName: lead.name,
      ...(tagline ? { tagline } : {}),
      ...(licenseNumber ? { licenseNumber } : {}),
      bbb: { accredited: false },
    },
    contact: {
      phone,
      email,
      address: {
        street: addr.street,
        city: addr.city,
        state: addr.state,
        zip: addr.zip,
      },
      hours: DEFAULT_HOURS,
      emergency24_7: niche_defaults.emergency24_7,
    },
    serviceArea: {
      zips,
      hqLatLng,
      radiusMiles: 50,
    },
    services: en.services && Array.isArray(en.services) && en.services.length
      ? en.services
      : niche_defaults.services,
    gallery,
    branding: {
      palette: brand.palette,
      fonts: brand.fonts,
    },
    hero: {
      image: en.heroImage || DEFAULT_HERO_IMAGE,
      service: niche_defaults.serviceCopy,
      city: `${addr.city}, ${addr.state}`,
      subhead: en.heroSubhead || heroSubhead(lead),
    },
    financing: { enabled: false },
    testimonials,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// --require evaluator (VAN-42)
//
// Field grammar:
//   licenseNumber           → siteConfig.business.licenseNumber non-empty
//   tagline                 → siteConfig.business.tagline non-empty
//   testimonials            → siteConfig.testimonials length >= 1
//   gallery                 → siteConfig.gallery length >= 1
//   serviceAreaZips         → siteConfig.serviceArea.zips length >= 1
//   serviceAreaZips>=N      → siteConfig.serviceArea.zips length >= N
//   city-not-street         → siteConfig.contact.address.city is not street-shaped
//
// Returns an array of human-readable missing-field strings (empty = all met).
// ─────────────────────────────────────────────────────────────────────────────

function evaluateRequired(spec, siteConfig) {
  const fields = String(spec)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const missing = [];
  for (const f of fields) {
    if (f === "licenseNumber") {
      if (!siteConfig.business.licenseNumber) missing.push("licenseNumber");
    } else if (f === "tagline") {
      if (!siteConfig.business.tagline) missing.push("tagline");
    } else if (f === "testimonials") {
      if (!siteConfig.testimonials || siteConfig.testimonials.length < 1) missing.push("testimonials");
    } else if (f === "gallery") {
      if (!siteConfig.gallery || siteConfig.gallery.length < 1) missing.push("gallery");
    } else if (f === "city-not-street") {
      if (looksLikeStreet(siteConfig.contact.address.city)) missing.push("city-not-street");
    } else {
      const zipM = f.match(/^serviceAreaZips(?:>=(\d+))?$/);
      if (zipM) {
        const min = zipM[1] ? Number(zipM[1]) : 1;
        const len = (siteConfig.serviceArea?.zips || []).length;
        if (len < min) missing.push(`serviceAreaZips>=${min} (have ${len})`);
      } else {
        missing.push(`${f} (unknown require key — treat as missing)`);
      }
    }
  }
  return missing;
}

// ─────────────────────────────────────────────────────────────────────────────
// Emit the file
// ─────────────────────────────────────────────────────────────────────────────

function renderFile({ lead, slug, siteConfig, warnings, requiredMissing }) {
  const header = [
    "// Auto-generated by Vantyx template-fill skill.",
    `// Lead: ${lead.name} (id=${lead.id})`,
    `// Slug: ${slug}`,
    `// Generated: ${ISO_NOW}`,
    warnings.length ? `// Warnings: ${warnings.join("; ")}` : null,
    requiredMissing && requiredMissing.length
      ? `// _required_missing: ${requiredMissing.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  // CRITICAL: the import line is HARDCODED. This is the entire point of
  // VAN-13 — the path string is never derived, never templated, never
  // touched by the model. If anyone changes this string, change it here
  // and update src/lib/site-config.ts to match.
  const importLine = `import type { SiteConfig } from "@/lib/site-config";`;

  const body = JSON.stringify(siteConfig, null, 2);

  return `${header}\n\n${importLine}\n\nexport const siteConfig: SiteConfig = ${body};\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Post-write invariant check — the same gate the AGENTS.md sed step enforced
// ─────────────────────────────────────────────────────────────────────────────

function verifyInvariants(content) {
  const checks = [
    { name: "export const siteConfig present", ok: /export const siteConfig\b/.test(content) },
    { name: "correct @/lib/site-config import", ok: /from "@\/lib\/site-config"/.test(content) },
    { name: "no self-import",                   ok: !/from "\.\/site\.config/.test(content) },
  ];
  const failed = checks.filter((c) => !c.ok);
  return { ok: failed.length === 0, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(
      "Usage: node run.mjs --lead-id <id> --brand-file <path> --template-dir <path>\n" +
        "                   [--leads-db <path>] [--enrichment-json <path>]\n" +
        "                   [--dry-run] [--out <path>]\n" +
        "                   [--require <comma-separated-field-list>]\n",
    );
    process.exit(0);
  }

  if (!args["lead-id"] && !args["lead-json"]) {
    die(1, "missing --lead-id <id> OR --lead-json <path>");
  }
  if (!args["template-dir"] && !args["out"] && !args["dry-run"]) {
    die(1, "missing --template-dir <path> (or --out, or --dry-run)");
  }

  const dbPath = args["leads-db"] || "/home/paperclip/vantyx-leads.sqlite";
  const lead = args["lead-id"]
    ? loadLeadFromDb(dbPath, args["lead-id"])
    : loadLeadFromJson(args["lead-json"]);
  requireLeadFields(lead);

  const warnings = [];
  const brand = parseBrandFile(args["brand-file"], warnings);

  let enrichment = null;
  if (args["enrichment-json"]) {
    if (!existsSync(args["enrichment-json"])) die(1, `enrichment-json not found: ${args["enrichment-json"]}`);
    try {
      enrichment = JSON.parse(readFileSync(args["enrichment-json"], "utf8"));
    } catch (e) {
      die(1, `enrichment-json parse error: ${e.message}`);
    }
  }

  const siteConfig = buildSiteConfig({ lead, brand, enrichment, warnings });
  const slug = slugify(lead.name);

  // VAN-42 --require: a comma-separated list of required-field keys. Empty
  // string is treated as "no requirement". The header also surfaces the list
  // as `_required_missing: ...` so humans eyeballing the generated file see
  // the gap immediately, even if exit 5 was bypassed (e.g. --dry-run | grep).
  const requireSpec = typeof args.require === "string" ? args.require : "";
  const requiredMissing = requireSpec ? evaluateRequired(requireSpec, siteConfig) : [];

  const content = renderFile({ lead, slug, siteConfig, warnings, requiredMissing });

  const check = verifyInvariants(content);
  if (!check.ok) {
    console.error("template-fill: post-write invariant check FAILED:");
    for (const c of check.failed) console.error(`  - ${c.name}`);
    process.exit(4);
  }

  if (args["dry-run"]) {
    process.stdout.write(content);
    if (requiredMissing.length) {
      console.error(
        `template-fill: required fields missing: ${requiredMissing.join(", ")}`,
      );
      process.exit(5);
    }
    return;
  }

  const outPath = args["out"]
    ? resolve(args["out"])
    : resolve(args["template-dir"], "site.config.ts");
  writeFileSync(outPath, content, "utf8");

  if (requiredMissing.length) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          wrote: outPath,
          lead_id: lead.id,
          slug,
          warnings,
          required_missing: requiredMissing,
        },
        null,
        2,
      ),
    );
    process.exit(5);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        wrote: outPath,
        lead_id: lead.id,
        slug,
        warnings,
      },
      null,
      2,
    ),
  );
}

main();
