---
name: email-enrich
description: Find a contact email for a lead by crawling its website (homepage + contact/about pages), filtering junk, preferring domain-matching role accounts. Writes to the lead only if it has no email yet.
inputs:
  - --lead-id <id>   read website from leads DB; with --write, store the found email (only if lead.email empty)
  - --url <url>      enrich an arbitrary URL (no DB write)
  - --write          persist best email to the lead
  - --json           pretty output
env:
  - (none; uses default leads DB /home/paperclip/vantyx-leads.sqlite)
exit:
  - 0 found · 2 none found · 1 CLI/IO error
---

Run with `NODE_OPTIONS=--experimental-sqlite`. gmaps-scrape gets phone, not email — this fills the gap for leads that have a website. Leads with no website (and no email) are email-unreachable and need the SMS channel instead. Never clobbers an existing email; prefers an address on the business's own domain over free webmail; mailto: links rank above plain-text matches.
