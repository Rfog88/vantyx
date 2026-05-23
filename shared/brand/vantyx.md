# Vantyx — Agency Brand Identity

**This file is the source of truth for Vantyx's voice. Every customer-facing
agent reads it on every run.** If a deliverable drifts from this file, QA
(Phase 1.5) fails the build via `brand-consistency-check`.

> **Ryan: fill in the bracketed sections.** The placeholders below are starting
> points only — your real positioning, palette, and founder story should replace
> them before the first client demo ships.

## Voice

- Local-first. Talks like a contractor, not a software vendor.
- "Done by Friday" energy. Concrete promises over fluffy guarantees.
- Never says "AI-powered" to clients. Says "your new website" or "your new
  online front door."
- Never uses the word "AI" in client-facing copy. The agency uses AI; the
  client doesn't need to know or care.
- Direct, no jargon, no emojis (matches Ryan's preferred style).

## Palette (placeholder — Ryan to confirm)

- Primary:    `#0F172A`  (slate-900)
- Accent:     `#F59E0B`  (amber-500)
- Background: `#FFFFFF`
- Text:       `#111827`  (gray-900)
- Muted:      `#6B7280`  (gray-500)

## Typography (placeholder)

- Headings: Inter, 700 weight, tight tracking.
- Body:     Inter, 400 weight, 1.65 line-height.
- Numerals: tabular for prices and phone numbers.

## Tagline candidates

- "Built like your trucks. Runs like your phones should."
- "The website your work deserves."
- "From Google Maps to first call — in one week."

(Ryan: pick one or write your own.)

## Founder story (Ryan to write)

> One short paragraph. Suggested arc: "Fogle & Sons Electric needed a website
> that actually converted. We built it ourselves, and realized every contractor
> in town has the same problem. So we built Vantyx to fix it — for them, fast."

## Non-negotiables for every client site

Every site built by Vantyx must include:

1. **License # + insurance badge** visible above the fold (trust signal for
   home-services).
2. **Mobile tap-to-call** in the header on mobile breakpoint.
3. **Real Google reviews** embedded (via `GoogleReviewsEmbed` component, live at
   build time) — not fake testimonials.
4. **Service-area map** with explicit ZIPs (via `ServiceAreaMap`).
5. **Contact form** that delivers to the client's email AND texts the owner.
6. **Schema.org JSON-LD** for LocalBusiness + Service in the footer.
7. **Lighthouse mobile ≥85** before deploy. Below that, dev fixes before
   shipping.

## When to deviate

If a client is in a niche that genuinely needs a different aesthetic
(e.g., high-end residential remodelers, custom-home builders), the UXDesigner
documents the deviation in `shared/brand/clients/<slug>.md`. **Do not deviate
silently.** Brand drift is a deliverable-rejection criterion for QA.
