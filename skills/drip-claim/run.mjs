#!/usr/bin/env node
// drip-claim — the PATH 2 / PATH 4 follow-up engine. Selects leads due for their next
// drip (Day 3 / Day 7 / Day 14) or nurture (~90d, max 2) step, applies every safety guard,
// ATOMICALLY claims the step, and returns the exact email to send. It does NOT send — the
// SDR (Sami) transports each returned item via gmail-send on the original thread.
//
// Guards (a claim must pass ALL):
//   - eligibility: stage='outreach_sent' AND reply_status IN (NULL,'soft_bounce')
//     (any real reply / suppression / stage change removes the lead from the drip)
//   - has outreach_thread_id + outreach_message_id (needed to reply "Re:" on-thread)
//   - NOT on the suppression list (email or domain)
//   - due by elapsed time off outreach_sent_at (3 / 7 / 14 days; nurture every 90d)
//   - lifetime ceiling: ≤3 drip + ≤2 nurture (1 cold + 3 + 2 = 6 max)
//   - inside the recipient-local send window (Mon–Fri morning; no Fri PM / weekends)
//   - under the combined daily cap (cold + drip + nurture)
//   - COMPLIANCE: a physical postal address (DRIP_POSTAL_ADDRESS) must be configured,
//     else the skill refuses to claim anything (every email legally needs it).
//
// Atomic claim = INSERT OR IGNORE a unique `drip:<lead>:<step>` row into sent_email_dedup
// (PK conflict ⇒ already claimed ⇒ skip) + a guarded drip_step/nurture_count advance.
// Claim happens BEFORE the send; a crash after claim under-sends, which the spec prefers.
//
// Usage:
//   node run.mjs [--limit N] [--now ISO] [--dry-run] [--ignore-window] [--json]
// Env: LEADS_DB_PATH, DRIP_DAILY_CAP(=15), DRIP_POSTAL_ADDRESS(required to claim),
//   DRIP_SAMI_PHONE, DRIP_UNSUBSCRIBE_LINK, DRIP_PROOF_URL(=https://fogleandsons.com),
//   DRIP_TIMEZONE(=America/New_York), DRIP_WINDOW(="7-12" local hours).
// Exit: 0 ok · 2 decision-needed · 3 adapter-broken

import { parseArgs } from "node:util";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  console.error(JSON.stringify({ error: "adapter-broken", reason: "node_sqlite_unavailable",
    detail: "Bind NODE_OPTIONS=--experimental-sqlite.", message: e.message }));
  process.exit(3);
}

const CAP        = parseInt(process.env.DRIP_DAILY_CAP || "15", 10);
const POSTAL     = (process.env.DRIP_POSTAL_ADDRESS || "").trim();
const PHONE      = (process.env.DRIP_SAMI_PHONE || "").trim();
const UNSUB      = (process.env.DRIP_UNSUBSCRIBE_LINK || "").trim();
const PROOF_URL  = (process.env.DRIP_PROOF_URL || "https://fogleandsons.com").trim();
const TZ         = (process.env.DRIP_TIMEZONE || "America/New_York").trim();
const WINDOW     = (process.env.DRIP_WINDOW || "7-12").trim();

const DAY = 86400000;
function normEmail(s) { return String(s || "").trim().toLowerCase().replace(/^<|>$/g, ""); }
function domainOf(e) { const m = normEmail(e).match(/@(.+)$/); return m ? m[1] : ""; }
// sqlite datetime('now') stores "YYYY-MM-DD HH:MM:SS" in UTC — parse as UTC.
function parseUtc(s) { if (!s) return null; const t = String(s).includes("T") ? String(s) : String(s).replace(" ", "T"); return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t + "Z"); }
function iso(d) { return d.toISOString().replace("T", " ").slice(0, 19); }
function dateStr(d) { return d.toISOString().slice(0, 10); }

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function localParts(date, tz) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hour12: false }).formatToParts(date);
  const weekday = p.find((x) => x.type === "weekday").value;
  let hour = parseInt(p.find((x) => x.type === "hour").value, 10);
  if (hour === 24) hour = 0;
  return { weekday, hour };
}
function windowOk(date, tz) {
  const [start, end] = WINDOW.split("-").map((n) => parseInt(n, 10));
  const { weekday, hour } = localParts(date, tz);
  const businessDay = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  return { ok: businessDay && hour >= start && hour < end, weekday, hour };
}

const TRADE = { electrician: "electrician", plumber: "plumber", hvac: "HVAC pro", roofer: "roofer" };
function footer() {
  const line1 = "Sami | Vantyx" + (PHONE ? ` | ${PHONE}` : "");
  const optout = `Don't want these? Reply "stop"` + (UNSUB ? ` or use ${UNSUB}` : "") + ` and I'll take you off the list for good.`;
  return `--\n${line1}\n${POSTAL}\n${optout}`;
}
function render(step, lead) {
  const biz = lead.name || "your business";
  const trade = TRADE[lead.niche] || lead.niche || "contractor";
  const demo = lead.demo_url || "";
  const f = "\n\n" + footer();
  // No confident first name yet (merge-field layer #4) → drop the salutation to "Hey".
  if (step === "day3") {
    return `Hey — just making sure the link to your demo site landed. Here it is again: ${demo}\n\n` +
      `It's built from what's already public about ${biz} — your reviews, services, the area you cover. Took about twenty minutes. Have a look when you get a minute and tell me what you think.\n\nSami${f}`;
  }
  if (step === "day7") {
    return `Hey — figured it'd help to see a finished one. Here's a site we did for a ${trade} like you: ${PROOF_URL}\n\n` +
      `Yours (${demo}) is the same idea — already roughed out from your public info. The photos and a couple details are all that's left, about ten more minutes once you're in. Worth a quick look?\n\nSami${f}`;
  }
  if (step === "day14") {
    // probe_finding (merge-field layer #4) not available yet → omit the finding sentence (spec: only claim a finding if one exists).
    const finding = (lead.probe_finding || "").trim();
    const findingClause = finding ? ` Quick reason it's worth ten minutes: ${finding} — that's costing you calls from people who look you up before they dial.` : "";
    return `Hey — last note from me on this. I know a website feels like one more thing when the phone's already ringing.${findingClause}\n\n` +
      `Your demo's still here if you want it: ${demo}. If now's not the time, no hard feelings — just reply and I'll close it out.\n\nSami${f}`;
  }
  // nurture
  return `Hey — Sami with Vantyx, circling back after a while. No agenda — just seeing whether a new website has moved up your list since we last talked.\n\n` +
    `If it has, I can refresh the concept we built for ${biz} in a day. If not, all good — I won't keep knocking.\n\nSami${f}`;
}

function dueStep(lead, now) {
  const sent = parseUtc(lead.outreach_sent_at);
  if (!sent) return null;
  const elapsedD = (now - sent) / DAY;
  const ds = lead.drip_step | 0;
  if (ds === 0 && elapsedD >= 3)  return { step: "day3",  key: "day3",  kind: "drip" };
  if (ds === 1 && elapsedD >= 7)  return { step: "day7",  key: "day7",  kind: "drip" };
  if (ds === 2 && elapsedD >= 14) return { step: "day14", key: "day14", kind: "drip" };
  if (ds >= 3) {
    const nc = lead.nurture_count | 0;
    if (nc >= 2) return null;                                   // lifetime nurture ceiling
    const last = parseUtc(lead.last_nurture_at) || parseUtc(lead.last_drip_at) || sent;
    if ((now - last) / DAY >= 90) return { step: "nurture", key: `nurture${nc + 1}`, kind: "nurture" };
  }
  return null;
}

async function main() {
  const { values } = parseArgs({ options: {
    limit: { type: "string" }, now: { type: "string" }, "dry-run": { type: "boolean" },
    "ignore-window": { type: "boolean" }, json: { type: "boolean" },
  } });

  const now = values.now ? new Date(values.now) : new Date();
  if (isNaN(now)) { console.error(JSON.stringify({ error: "decision-needed", reason: "bad --now" })); process.exit(2); }
  const today = dateStr(now);
  const dry = !!values["dry-run"];

  // COMPLIANCE GATE — refuse to claim without a physical postal address.
  if (!POSTAL && !dry) {
    console.log(JSON.stringify({ claimed: [], count: 0, blocked: "compliance",
      reason: "DRIP_POSTAL_ADDRESS unset — every drip email legally needs a physical address. Set it before enabling drip." }));
    return;
  }

  // Send window (global tz until per-lead tz in #4).
  const win = windowOk(now, TZ);
  if (!win.ok && !values["ignore-window"]) {
    console.log(JSON.stringify({ claimed: [], count: 0, blocked: "send-window",
      window: WINDOW, tz: TZ, local_weekday: win.weekday, local_hour: win.hour,
      reason: "outside recipient-local send window (Mon-Fri morning only)" }));
    return;
  }

  const db = new DatabaseSync(process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite");

  // Combined daily cap: cold + drip + nurture claimed today.
  const countToday = (col) => db.prepare(`SELECT COUNT(*) n FROM leads WHERE substr(${col},1,10)=?`).get(today).n;
  const sentToday = countToday("outreach_sent_at") + countToday("last_drip_at") + countToday("last_nurture_at");
  const cap = values.limit ? parseInt(values.limit, 10) : CAP;
  let remaining = Math.max(0, cap - sentToday);

  // Eligible pool, oldest cold-send first.
  const pool = db.prepare(
    `SELECT id,name,niche,city,state,email,demo_url,
            outreach_sent_at,outreach_thread_id,outreach_message_id,outreach_subject,
            reply_status,drip_step,nurture_count,last_drip_at,last_nurture_at
     FROM leads
     WHERE stage='outreach_sent'
       AND (reply_status IS NULL OR reply_status='soft_bounce')
       AND email IS NOT NULL AND TRIM(email) <> ''
     ORDER BY outreach_sent_at ASC`
  ).all();

  const isSuppressed = (email) => db.prepare(
    "SELECT 1 FROM suppressions WHERE (scope='email' AND value=?) OR (scope='domain' AND value=?) LIMIT 1"
  ).get(normEmail(email), domainOf(email));

  const claimNow = iso(now);
  const claimed = [];
  const skipped = { not_due: 0, suppressed: 0, no_thread: 0, cap_reached: 0, race: 0 };

  for (const lead of pool) {
    if (remaining <= 0) { skipped.cap_reached++; continue; }
    const due = dueStep(lead, now);
    if (!due) { skipped.not_due++; continue; }
    if (!lead.outreach_thread_id || !lead.outreach_message_id) { skipped.no_thread++; continue; }
    try { if (isSuppressed(lead.email)) { skipped.suppressed++; continue; } } catch { /* table absent */ }

    const dedupKey = `drip:${lead.id}:${due.key}`;
    const body = render(due.step, lead);
    const item = {
      leadId: lead.id, name: lead.name, step: due.step, kind: due.kind,
      to: lead.email, threadId: lead.outreach_thread_id, inReplyTo: lead.outreach_message_id,
      subject: "Re: " + (lead.outreach_subject || `${lead.name} — your new site`),
      body, dedupKey,
    };

    if (dry) { claimed.push({ ...item, would_claim: true }); remaining--; continue; }

    // 1) atomic claim ledger row (PK conflict ⇒ already claimed)
    const ins = db.prepare("INSERT OR IGNORE INTO sent_email_dedup (dedup_key, message_id, sent_at) VALUES (?,?,?)")
      .run(dedupKey, "drip-claimed", claimNow);
    if (ins.changes === 0) { skipped.race++; continue; }
    // 2) guarded state advance
    let upd;
    if (due.kind === "drip") {
      const nextStep = due.step === "day3" ? 1 : due.step === "day7" ? 2 : 3;
      upd = db.prepare(
        `UPDATE leads SET drip_step=?, last_drip_at=?, updated_at=datetime('now')
         WHERE id=? AND drip_step=? AND stage='outreach_sent' AND (reply_status IS NULL OR reply_status='soft_bounce')`
      ).run(nextStep, claimNow, lead.id, nextStep - 1);
    } else {
      upd = db.prepare(
        `UPDATE leads SET nurture_count=nurture_count+1, last_nurture_at=?, updated_at=datetime('now')
         WHERE id=? AND nurture_count=? AND drip_step>=3 AND (reply_status IS NULL OR reply_status='soft_bounce')`
      ).run(claimNow, lead.id, lead.nurture_count | 0);
    }
    if (upd.changes !== 1) { skipped.race++; continue; }   // raced (reply landed mid-claim); ledger row stays → safe under-send
    claimed.push(item);
    remaining--;
  }

  db.close();
  console.log(JSON.stringify({
    now: claimNow, tz: TZ, window: WINDOW, window_ok: win.ok,
    cap, sent_today: sentToday, remaining_after: Math.max(0, remaining),
    postal_ok: !!POSTAL, dry_run: dry,
    count: claimed.length, claimed, skipped,
  }, null, values.json ? 2 : 0));
}

main().catch((e) => { console.error(JSON.stringify({ error: "unknown-failure", message: e.message })); process.exit(1); });
