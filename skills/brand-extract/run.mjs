#!/usr/bin/env node
// brand-extract — Phase 1.5 lightweight scraper (no Playwright).
//
// Fetches a lead's current website over HTTP and pulls out:
//   - title / H1 / tagline candidates
//   - logo URL (best-effort: <img> in header, <header>, or favicon fallback)
//   - palette hints from inline/linked CSS (custom props + bg/color)
//   - font hints from Google Fonts links + body/heading CSS
//   - service list from <nav>/<ul> + headings
//   - NAP regex: phone, address, hours
//
// Output JSON is consumed by UXDesigner (Dyna) when she authors the
// per-client brand file at shared/brand/clients/<lead-slug>.md.
//
// Invocation:
//   node skills/brand-extract/run.mjs --lead-id <uuid> --url https://acme.com
//
// Graceful degrade: if the site is unreachable, returns a niche-default
// payload so the demo-gen pipeline can still proceed (Dyna picks defaults).

import { parseArgs } from "node:util";

const TIMEOUT_MS = 12_000;

function defaultPaletteByNiche(niche) {
  switch (niche) {
    case "electrician":   return { primary: "#0F172A", accent: "#FACC15", bg: "#FFFFFF", text: "#111827", muted: "#6B7280" };
    case "plumber":       return { primary: "#0B3D91", accent: "#FFFFFF", bg: "#FFFFFF", text: "#111827", muted: "#6B7280" };
    case "hvac":          return { primary: "#0F172A", accent: "#DC2626", bg: "#FFFFFF", text: "#111827", muted: "#6B7280" };
    case "roofer":        return { primary: "#3F2A1A", accent: "#D97706", bg: "#FAFAF7", text: "#1C1917", muted: "#78716C" };
    case "gc":            return { primary: "#1F2937", accent: "#F59E0B", bg: "#FFFFFF", text: "#111827", muted: "#6B7280" };
    default:              return { primary: "#0F172A", accent: "#F59E0B", bg: "#FFFFFF", text: "#111827", muted: "#6B7280" };
  }
}

function absUrl(href, base) {
  if (!href) return null;
  try { return new URL(href, base).href; } catch { return null; }
}

function extractLogo(html, base) {
  // Candidates in priority order.
  const patterns = [
    /<header[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+(?:class|alt|id)=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+(?:class|alt|id)=["'][^"']*logo[^"']*["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return absUrl(m[1], base);
  }
  // Fallback: favicon
  const fav = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
  if (fav) return absUrl(fav[1], base);
  return null;
}

function extractColors(html) {
  const hexes = html.match(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi) || [];
  // Frequency rank — top distinct.
  const counts = new Map();
  for (const h of hexes) {
    const norm = h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`.toLowerCase() : h.toLowerCase();
    counts.set(norm, (counts.get(norm) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
}

function extractFonts(html) {
  const fonts = new Set();
  const gf = html.match(/fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/i);
  if (gf) {
    const fam = decodeURIComponent(gf[1].split(":")[0]).replace(/\+/g, " ");
    fonts.add(fam);
  }
  const ff = html.match(/font-family\s*:\s*['"]?([A-Za-z][A-Za-z0-9 \-]+?)['"]?[;,}]/gi) || [];
  for (const m of ff.slice(0, 5)) {
    const name = m.match(/font-family\s*:\s*['"]?([A-Za-z][A-Za-z0-9 \-]+)/i)?.[1]?.trim();
    if (name && !/^(serif|sans-serif|monospace|system-ui|inherit)$/i.test(name)) fonts.add(name);
  }
  return [...fonts].slice(0, 3);
}

function extractH1(html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim() : null;
}

function extractServicesGuess(html) {
  // Look for <nav> or <ul> with 3-12 items, pick the most likely services list.
  const lists = html.match(/<ul[^>]*>[\s\S]*?<\/ul>/gi) || [];
  for (const list of lists) {
    const items = (list.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [])
      .map(li => li.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
      .filter(t => t.length > 2 && t.length < 60);
    if (items.length >= 3 && items.length <= 12) {
      // Heuristic: if items look like services (capitalized phrases, not nav links)
      const servicey = items.filter(t => /^[A-Z]/.test(t) && !/^(home|about|contact|services|menu|login)/i.test(t));
      if (servicey.length >= 3) return servicey.slice(0, 8);
    }
  }
  return [];
}

function extractNAP(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const phone = text.match(/\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/)?.[0] || null;
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] || null;
  const zipState = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*,?\s*([A-Z]{2})\s+(\d{5})\b/);
  return {
    phone,
    email,
    city: zipState?.[1] || null,
    state: zipState?.[2] || null,
    zip: zipState?.[3] || null,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      "lead-id": { type: "string" },
      url: { type: "string" },
      niche: { type: "string", default: "gc" },
    },
  });

  const { url } = values;
  const niche = values.niche;

  if (!url) {
    // No site at all — return niche-default payload.
    console.log(JSON.stringify({
      logo_url: null,
      palette: defaultPaletteByNiche(niche),
      fonts: ["Inter", "system-ui"],
      h1_voice_sample: null,
      title: null,
      services: [],
      nap: { phone: null, email: null, city: null, state: null, zip: null },
      _status: "no-website",
      _note: "Lead has no website; using niche-default palette and fonts. UXDesigner to author full brand file from niche playbook.",
    }));
    return;
  }

  const target = url.startsWith("http") ? url : `https://${url}`;
  try {
    const res = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VantyxBot/1.0; +https://vantyx.com)" },
    });
    if (!res.ok) {
      console.log(JSON.stringify({
        _status: "unreachable",
        _http_status: res.status,
        palette: defaultPaletteByNiche(niche),
        fonts: ["Inter", "system-ui"],
        nap: {},
        services: [],
      }));
      return;
    }
    const html = await res.text();

    // Best-effort extraction
    const colors = extractColors(html);
    const palette = defaultPaletteByNiche(niche);
    if (colors.length >= 1) palette.primary = colors[0];
    if (colors.length >= 2) palette.accent = colors[1];

    const out = {
      logo_url: extractLogo(html, target),
      palette,
      fonts: extractFonts(html),
      title: extractTitle(html),
      h1_voice_sample: extractH1(html),
      services: extractServicesGuess(html),
      nap: extractNAP(html),
      _status: "ok",
      _source_url: target,
      _palette_candidates: colors.slice(0, 6),
    };

    console.log(JSON.stringify(out));
  } catch (e) {
    console.log(JSON.stringify({
      _status: "error",
      _error: e.message,
      palette: defaultPaletteByNiche(niche),
      fonts: ["Inter", "system-ui"],
      nap: {},
      services: [],
    }));
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
