#!/usr/bin/env node
// template-fill — write site.config.ts in a Vantyx Web OS clone, merging
// SQLite lead row + per-client brand file + agency-brand fallbacks.
//
// Invocation:
//   node skills/template-fill/run.mjs --lead-id <uuid> --clone-path /tmp/demos/<slug> --client-slug <slug>

import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
    },
  });

  const leadId = values["lead-id"];
  const clonePath = values["clone-path"];
  const slug = values["client-slug"];

  if (!leadId || !clonePath || !slug) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "missing required arg(s)", got: { leadId, clonePath, slug } }));
    process.exit(2);
  }
  if (!existsSync(clonePath) || !statSync(clonePath).isDirectory()) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "clone-path missing or not a directory", clonePath }));
    process.exit(2);
  }

  const db = openDb();
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(leadId);
  db.close();

  if (!lead) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "lead-id not found", leadId }));
    process.exit(2);
  }

  const warnings = [];
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
  const config = {
    business: {
      name: lead.name || "Your Business",
      legalName: lead.name || "Your Business",
      tagline: undefined,
      licenseNumber: undefined,
      insurance: undefined,
      bbb: { accredited: false },
      foundedYear: undefined,
      googlePlaceId: undefined,
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
      zips: [lead.zip || "45801"],
      hqLatLng: [40.7426, -84.1052],   // Lima default; brand-extract may override Phase 2
      radiusMiles: 50,
    },
    services,
    gallery: [],
    branding: {
      palette,
      fonts,
    },
    hero: {
      image: "https://images.unsplash.com/photo-1581094288338-2314dddb7ece?w=1920&q=80",
      service: nicheLabel(niche),
      city: `${cityName}, ${lead.state || "OH"}`,
      subhead: lead.gmaps_rating
        ? `${lead.gmaps_rating}★ rated, locally owned, licensed and insured.`
        : "Locally owned, licensed and insured.",
    },
    financing: niche === "roofer" || niche === "hvac" ? { enabled: true } : { enabled: false },
    testimonials: [],
  };

  const fileBody = renderConfigFile(config, lead, slug, warnings);
  const target = resolve(clonePath, "site.config.ts");
  writeFileSync(target, fileBody, "utf8");

  console.log(JSON.stringify({
    wrote: target,
    bytes: Buffer.byteLength(fileBody, "utf8"),
    warnings,
  }));
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

function renderConfigFile(config, lead, slug, warnings) {
  const header = [
    `// Auto-generated by Vantyx template-fill skill.`,
    `// Lead: ${lead.name} (id=${lead.id})`,
    `// Slug: ${slug}`,
    `// Generated: ${new Date().toISOString()}`,
    warnings.length ? `// Warnings: ${warnings.join("; ")}` : null,
  ].filter(Boolean).join("\n");

  return `${header}

import type { SiteConfig } from "./site.config";

export const siteConfig: SiteConfig = ${JSON.stringify(config, null, 2)};
`;
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
