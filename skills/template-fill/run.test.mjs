// VAN-67 regression: generated site.config.ts must reference the SiteConfig
// type at its canonical location (@/lib/site-config), and must compile.
//
// Invocation:
//   node --test skills/template-fill/run.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderConfigFile } from "./run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const sampleConfig = {
  business: { name: "Acme Electric", legalName: "Acme Electric LLC", bbb: { accredited: false } },
  contact: {
    phone: "(555) 555-5555",
    email: "hello@acme.test",
    address: { street: "Service area listed below", city: "Lima", state: "OH", zip: "45801" },
    hours: {
      mon: "7:00 AM – 6:00 PM",
      tue: "7:00 AM – 6:00 PM",
      wed: "7:00 AM – 6:00 PM",
      thu: "7:00 AM – 6:00 PM",
      fri: "7:00 AM – 6:00 PM",
      sat: "8:00 AM – 2:00 PM",
      sun: "Closed",
    },
    emergency24_7: true,
  },
  serviceArea: { zips: ["45801"], hqLatLng: [40.7426, -84.1052], radiusMiles: 50 },
  services: [{ title: "Panel Upgrades", description: "100A→200A.", icon: "Zap" }],
  gallery: [],
  branding: {
    palette: { primary: "#0F172A", accent: "#FACC15", bg: "#FFFFFF", text: "#111827", muted: "#6B7280" },
    fonts: { headings: "Inter, system-ui, sans-serif", body: "Inter, system-ui, sans-serif" },
  },
  hero: { service: "Electrician", city: "Lima, OH" },
  financing: { enabled: false },
  testimonials: [],
};

const sampleLead = { id: "test-lead-0", name: "Acme Electric" };

test("renderConfigFile emits SiteConfig import from @/lib/site-config (VAN-67)", () => {
  const body = renderConfigFile(sampleConfig, sampleLead, "acme-electric", []);
  assert.match(body, /import type \{ SiteConfig \} from "@\/lib\/site-config";/);
  assert.doesNotMatch(
    body,
    /from "\.\/site\.config"/,
    "site.config.ts must not self-import — SiteConfig type is not exported from this file",
  );
  assert.match(body, /export const siteConfig: SiteConfig =/);
});

// Integration check: write the generated file into a fixture clone of the
// real vantyx-web-os layout and run tsc. Skips if a usable tsc + types are
// not reachable from this droplet.
test("generated site.config.ts type-checks against the real SiteConfig", () => {
  const realTsc = findTsc();
  const realTypePath = findRealSiteConfigType();
  if (!realTsc || !realTypePath) {
    console.log(JSON.stringify({ skipped: true, reason: "tsc or real site-config.ts not reachable", realTsc, realTypePath }));
    return;
  }

  const fixture = mkdtempSync(join(tmpdir(), "van67-templatefill-"));
  try {
    mkdirSync(join(fixture, "src", "lib"), { recursive: true });
    copyFileSync(realTypePath, join(fixture, "src", "lib", "site-config.ts"));

    writeFileSync(
      join(fixture, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          skipLibCheck: true,
          isolatedModules: true,
          baseUrl: ".",
          paths: { "@/*": ["./src/*"] },
        },
        include: ["site.config.ts", "src/**/*.ts"],
      }),
      "utf8",
    );

    const body = renderConfigFile(sampleConfig, sampleLead, "acme-electric", []);
    writeFileSync(join(fixture, "site.config.ts"), body, "utf8");

    const result = spawnSync(realTsc, ["--noEmit", "-p", fixture], { encoding: "utf8" });
    assert.equal(
      result.status,
      0,
      `tsc must succeed on generated site.config.ts\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

function findTsc() {
  // Prefer a tsc colocated with a real vantyx-web-os clone, then PATH.
  const candidates = [
    "/tmp/vantyx-web-os/node_modules/.bin/tsc",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  const which = spawnSync("which", ["tsc"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  return null;
}

function findRealSiteConfigType() {
  const candidates = [
    "/tmp/vantyx-web-os/src/lib/site-config.ts",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}
