# Vantyx — Lovable Demo Prompt Template

This is the master prompt Vantyx sends to **Lovable** to build a prospect's demo site. It is Ryan's
approved "BlueLine Plumbing" prompt with the company specifics turned into `{{PLACEHOLDER}}` tokens.
The `prompt-fill` skill reads a lead row, substitutes the tokens, and sends everything **after the
delimiter line** to Lovable via the MCP `create` tool. Everything **above the delimiter** is
documentation and is NOT sent.

## Placeholder → source map

| Placeholder              | leads column / source                                            |
|--------------------------|------------------------------------------------------------------|
| `{{COMPANY_NAME}}`       | `name` (required)                                                |
| `{{TAGLINE}}`            | `tagline`                                                        |
| `{{NICHE_LABEL}}`        | derived from `niche` (e.g. plumber → "residential plumbing")     |
| `{{SERVICE_AREA_LABEL}}` | built from `city`, `state`, `service_area_zips`                  |
| `{{PHONE}}`              | `phone` (required) — formatted (123) 456-7890                    |
| `{{HOURS}}`              | default "Mon–Sat 7am–7pm, 24/7 Emergency Service" (no column)    |
| `{{ESTABLISHED}}`        | no column → `[NOT PROVIDED]` (omit)                              |
| `{{LICENSE_NO}}`         | `license_no` — omit badge if `[NOT PROVIDED]`; never invent      |
| `{{GMAPS_RATING}}`       | `gmaps_rating` — never invent if `[NOT PROVIDED]`                |
| `{{REVIEW_COUNT}}`       | `review_count` — never invent if `[NOT PROVIDED]`                |
| `{{SERVICES}}`           | niche-appropriate service list (derived from `niche`)            |
| `{{OFFER}}`              | default "$50 Off Your First Service" (no column)                 |
| `{{TESTIMONIALS}}`       | `testimonials` if present, else an instruction to write realistic ones |
| `{{GBP_HERO_URL}}`       | `gbp_hero_url`                                                   |

Fields with no data are substituted with the literal `[NOT PROVIDED]`; the prompt tells Lovable to
omit those gracefully and to never fabricate a license number, rating, or review count.

<!-- ===PROMPT BODY — everything below this line is sent to Lovable=== -->

Build a premium, conversion-focused demo website for a local home-services company. This is a
showcase/demo, so it doesn't need backend functionality (forms and booking can be front-end only
with a success state). Build it as a **frontend-only** site with **no Supabase, no auth, no
database, no server functions, and no login/signup wall** — the published page must be fully public
and show the marketing content immediately to anyone who opens the link. Make it look and perform
like the best {{NICHE_LABEL}} website in the world.

Company:

    •    Name: {{COMPANY_NAME}}
    •    Tagline: "{{TAGLINE}}"
    •    Location: {{SERVICE_AREA_LABEL}}
    •    Phone: {{PHONE}}
    •    Hours: {{HOURS}}
    •    Established: {{ESTABLISHED}} · Licensed #{{LICENSE_NO}} · Insured
    •    Rating: {{GMAPS_RATING}} stars, {{REVIEW_COUNT}}+ reviews

Data honesty: any field shown as `[NOT PROVIDED]` means we don't have that data — omit that element
gracefully and never print the literal token. Never invent a license number, a star rating, or a
review count; if those are `[NOT PROVIDED]`, simply leave them out and phrase the trust copy without
a specific figure. Other supporting copy (benefits, FAQ answers, financing terms) should be written
realistically (no lorem ipsum) so it reads like a real company.

Brand & feel: Clean, modern, trustworthy. Blue/white primary palette with a bold orange accent for
CTAs. Professional but approachable. Subtle animations, premium typography (Inter or Plus Jakarta
Sans), generous whitespace.

Key conversion elements:

    •    Sticky header with click-to-call phone number, logo, nav, prominent "Book Service" button
    •    Hero with strong headline, subheadline, "Call Now" + "Schedule Online" CTAs, and trust
         badges (Licensed & Insured, 24/7 Emergency, rating if provided, established year if provided)
    •    Floating "Call Now" button on mobile
    •    Above-the-fold emergency banner

Sections (in order):

    1.    Hero
    2.    Trust bar — Licensed, Insured, BBB A+, Google rating (if provided), Financing Available
    3.    Services grid — icon cards for: {{SERVICES}}
    4.    Why Choose Us — upfront pricing, on-time guarantee, background-checked techs, warranty,
          same-day service
    5.    How It Works — Book → We Arrive On Time → Problem Solved
    6.    Testimonials carousel with star ratings and names — {{TESTIMONIALS}}
    7.    Service area list/map of neighborhoods served
    8.    Financing & offers — "{{OFFER}}"
    9.    FAQ accordion
    10.   Final CTA band + contact form (name, phone, email, service needed, message — front-end
          only with success state)
    11.   Footer — hours, phone, address, license # (if provided), social links

Technical/UX:

    •    Fully mobile-responsive (home-services traffic is mostly mobile)
    •    Fast-loading, accessible (WCAG)
    •    SEO-optimized: semantic HTML, meta tags, LocalBusiness + review schema markup, descriptive
         headings. Put the company name and phone number in static, crawlable markup.
    •    Click-to-call everywhere on mobile (`tel:` links)
    •    Smooth scroll and subtle scroll-reveal animations

Copy: Write professional, benefit-driven copy throughout (no lorem ipsum) so it reads like a real
company. CTAs like "Schedule Service," "Call Now," "Get a Free Estimate." Never use the word "AI"
and never use emojis.

Make it polished enough to win design awards while staying laser-focused on generating calls and
booked jobs.
