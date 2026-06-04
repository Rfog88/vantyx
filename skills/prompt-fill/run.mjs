#!/usr/bin/env node
/**
 * Vantyx prompt-fill — deterministic filler for the Lovable demo prompt.
 *
 * Reads a lead row from the leads DB, substitutes the {{PLACEHOLDER}} tokens in
 * `shared/lovable-demo-prompt.md`, and writes the finished prompt that
 * `lovable-build` sends to Lovable via the MCP `create` tool. No LLM in the
 * write path — this is straight string interpolation, the same discipline the
 * retired `template-fill` skill used for `site.config.ts`.
 *
 * Usage:
 *   node run.mjs --lead-id <id> [--prompt-template <path>] [--leads-db <path>]
 *                [--out <path>] [--require <csv>] [--stdout]
 *   node run.mjs --lead-json <path> --allow-lead-json [...]
 *
 * Exit codes:
 *   0  — wrote the filled prompt
 *   1  — CLI / IO error (missing arg, unreadable file)
 *   2  — lead not found / missing required fields / a --require placeholder empty
 *   3  — template contains an unknown {{PLACEHOLDER}} this skill can't resolve
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ISO_NOW = new Date().toISOString();
const DEFAULT_DB = "/home/paperclip/vantyx-leads.sqlite";
const DEFAULT_TEMPLATE = "shared/lovable-demo-prompt.md";
const DELIMITER_RE = /<!--\s*===PROMPT BODY[^>]*===\s*-->/i;
const NOT_PROVIDED = "[NOT PROVIDED]";

// ── Niche-derived copy (mirrors the niche catalog the old template-fill used) ──
const NICHE_LABELS = {
  electrician: "residential & commercial electrical",
  plumber: "residential plumbing",
  hvac: "heating & cooling (HVAC)",
  roofer: "residential roofing",
  gc: "general contracting & remodeling",
};

const NICHE_SERVICES = {
  electrician: ["Panel Upgrades", "EV Charger Installation", "Whole-Home Rewiring", "Generator Hookups", "Lighting & Ceiling Fans", "Outlet & Switch Repair", "Surge Protection", "Emergency Electrical"],
  plumber: ["Drain Cleaning", "Water Heaters (tank & tankless)", "Leak Detection & Repair", "Pipe Repair/Repiping", "Toilet & Faucet Repair", "Sewer Line", "Garbage Disposals", "Water Filtration"],
  hvac: ["AC Repair", "Furnace Installation", "Heat Pumps & Mini-Splits", "Duct Cleaning", "Indoor Air Quality", "Thermostat Upgrades", "Maintenance Plans", "Emergency HVAC"],
  roofer: ["Roof Replacement", "Roof Repair", "Storm & Hail Damage", "Metal Roofing", "Gutter Installation", "Skylights", "Flashing & Leak Repair", "Free Roof Inspections"],
  gc: ["Kitchen Remodels", "Bathroom Remodels", "Room Additions", "Basement Finishing", "Decks & Patios", "Whole-Home Renovations", "Custom Carpentry", "Design-Build"],
};

const DEFAULT_HOURS = "Mon–Sat 7am–7pm, 24/7 Emergency Service";
const DEFAULT_OFFER = "$50 Off Your First Service";

// ─────────────────────────────────────────────────────────────────────────────
// CLI
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
  console.error(`prompt-fill: ${msg}`);
  process.exit(code);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead loading (lifted from template-fill, extended with gbp_hero_url)
// ─────────────────────────────────────────────────────────────────────────────

function loadLeadFromDb(dbPath, leadId) {
  if (!existsSync(dbPath)) die(1, `leads-db not found: ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db
    .prepare(
      `SELECT id, name, phone, email, website, niche, city, state, zip,
              gmaps_rating, review_count, score, stage, demo_url,
              license_no, service_area_zips, testimonials, gallery, tagline,
              gbp_hero_url
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (lifted from template-fill)
// ─────────────────────────────────────────────────────────────────────────────

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function formatPhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return String(raw);
}

function safeJsonArray(raw) {
  if (raw == null || raw === "") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function clean(v) {
  const s = v == null ? "" : String(v).trim();
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder resolution — every token the template may contain
// ─────────────────────────────────────────────────────────────────────────────

function buildServiceAreaLabel(lead) {
  const city = clean(lead.city);
  const state = clean(lead.state);
  const zips = safeJsonArray(lead.service_area_zips).map((z) => clean(z)).filter(Boolean);
  let base = "";
  if (city && state) base = `${city}, ${state}`;
  else if (city) base = city;
  else if (state) base = state;
  if (!base) return "";
  if (zips.length) return `${base} (serving ZIP codes ${zips.join(", ")})`;
  return base;
}

function formatTestimonials(lead) {
  const arr = safeJsonArray(lead.testimonials);
  if (!arr.length) {
    return "we have no reviews on file, so write 3–4 realistic, believable customer reviews with a first name + last initial and 5-star ratings (this is a demo)";
  }
  const lines = arr
    .map((t) => {
      const body = clean(t.body || t.quote);
      const author = clean(t.author);
      const loc = clean(t.location);
      const rating = typeof t.rating === "number" ? t.rating : 5;
      if (!body) return "";
      return `"${body}" — ${author || "Customer"}${loc ? `, ${loc}` : ""} (${rating}★)`;
    })
    .filter(Boolean);
  if (!lines.length) {
    return "we have no usable reviews on file, so write 3–4 realistic, believable customer reviews with a first name + last initial and 5-star ratings (this is a demo)";
  }
  return `use these real customer reviews — ${lines.join("; ")}`;
}

function normalizeLicense(value) {
  const trimmed = clean(value);
  if (!trimmed) return "";
  // Reject canonical placeholder junk — better to omit the badge than fake one.
  if (/^(x{4,}|0{4,}|9{4,}|-{4,}|placeholder|tbd|unknown|n\/?a)$/i.test(trimmed)) return "";
  return trimmed;
}

// Returns { values: {TOKEN: string}, provided: Set<TOKEN> }.
// A token is "provided" when we have real data for it (i.e. not [NOT PROVIDED]).
function resolvePlaceholders(lead) {
  const niche = clean(lead.niche).toLowerCase();
  const services = (NICHE_SERVICES[niche] || NICHE_SERVICES.electrician).join(", ");
  const nicheLabel = NICHE_LABELS[niche] || "home services";
  const gallery = safeJsonArray(lead.gallery)
    .map((g) => clean(g.after || g.src || g.before || g))
    .filter(Boolean);

  // Raw resolved values BEFORE the [NOT PROVIDED] substitution.
  const raw = {
    COMPANY_NAME: clean(lead.name),
    TAGLINE: clean(lead.tagline),
    NICHE: niche,
    NICHE_LABEL: nicheLabel,
    SERVICE_AREA_LABEL: buildServiceAreaLabel(lead),
    CITY: clean(lead.city),
    STATE: clean(lead.state),
    ZIP: clean(lead.zip),
    PHONE: formatPhone(lead.phone),
    EMAIL: clean(lead.email),
    WEBSITE: clean(lead.website),
    HOURS: DEFAULT_HOURS,
    ESTABLISHED: "", // no column — omit
    LICENSE_NO: normalizeLicense(lead.license_no),
    GMAPS_RATING: clean(lead.gmaps_rating),
    REVIEW_COUNT: clean(lead.review_count),
    SERVICES: services,
    OFFER: DEFAULT_OFFER,
    TESTIMONIALS: formatTestimonials(lead),
    GALLERY: gallery.length ? gallery.join(", ") : "",
    GBP_HERO_URL: clean(lead.gbp_hero_url),
  };

  const values = {};
  const provided = new Set();
  for (const [k, v] of Object.entries(raw)) {
    if (v === "" || v == null) {
      values[k] = NOT_PROVIDED;
    } else {
      values[k] = String(v);
      provided.add(k);
    }
  }
  return { values, provided };
}

// ─────────────────────────────────────────────────────────────────────────────
// Substitution
// ─────────────────────────────────────────────────────────────────────────────

function extractPromptBody(template) {
  const m = template.match(DELIMITER_RE);
  if (!m) return template; // no delimiter → whole file is the prompt
  return template.slice(m.index + m[0].length).replace(/^\s*\n/, "");
}

function substitute(body, values) {
  const tokenRe = /\{\{([A-Z0-9_]+)\}\}/g;
  const unknown = new Set();
  const out = body.replace(tokenRe, (full, token) => {
    if (Object.prototype.hasOwnProperty.call(values, token)) return values[token];
    unknown.add(token);
    return full;
  });
  return { out, unknown: [...unknown] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(
      "Usage: node run.mjs --lead-id <id> [--prompt-template <path>] [--leads-db <path>]\n" +
        "                   [--out <path>] [--require <csv>] [--stdout]\n",
    );
    process.exit(0);
  }

  if (!args["lead-id"] && !args["lead-json"]) die(1, "missing --lead-id <id>");
  if (args["lead-id"] && args["lead-json"]) die(1, "pass only one lead source: --lead-id OR --lead-json");
  if (args["lead-json"] && !args["allow-lead-json"]) {
    die(1, "refusing --lead-json without --allow-lead-json (prevents fixture-driven builds)");
  }

  const dbPath = args["leads-db"] || process.env.LEADS_DB_PATH || DEFAULT_DB;
  const lead = args["lead-id"]
    ? loadLeadFromDb(dbPath, args["lead-id"])
    : loadLeadFromJson(args["lead-json"]);

  const missingCore = ["id", "name", "niche", "phone"].filter((k) => !clean(lead[k]));
  if (missingCore.length) die(2, `lead missing required fields: ${missingCore.join(", ")}`);

  const templatePath = resolve(args["prompt-template"] || DEFAULT_TEMPLATE);
  if (!existsSync(templatePath)) die(1, `prompt-template not found: ${templatePath}`);
  const template = readFileSync(templatePath, "utf8");
  const body = extractPromptBody(template);

  const { values, provided } = resolvePlaceholders(lead);
  const { out, unknown } = substitute(body, values);

  if (unknown.length) {
    die(3, `template contains unknown placeholder(s) this skill cannot resolve: ${unknown.map((u) => `{{${u}}}`).join(", ")}`);
  }

  const slug = slugify(lead.name);
  const emptyPlaceholders = Object.keys(values).filter((k) => values[k] === NOT_PROVIDED);

  // --require: comma-separated placeholder names that must be provided.
  const requireSpec = typeof args.require === "string" ? args.require : "COMPANY_NAME,PHONE,NICHE_LABEL";
  const requiredMissing = requireSpec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((tok) => !provided.has(tok));

  const summary = {
    ok: requiredMissing.length === 0,
    lead_id: lead.id,
    slug,
    prompt_chars: out.length,
    filled_placeholders: [...provided],
    empty_placeholders: emptyPlaceholders,
    required_missing: requiredMissing,
    generated: ISO_NOW,
  };

  if (args.stdout) {
    process.stdout.write(out);
    console.error(JSON.stringify(summary, null, 2));
    process.exit(requiredMissing.length ? 2 : 0);
  }

  const outPath = resolve(args.out || `/tmp/demos/${slug}/lovable-prompt.txt`);
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, out, "utf8");
  } catch (e) {
    die(1, `failed to write ${outPath}: ${e.message}`);
  }
  summary.prompt_path = outPath;

  console.log(JSON.stringify(summary, null, 2));
  if (requiredMissing.length) process.exit(2);
}

main();
