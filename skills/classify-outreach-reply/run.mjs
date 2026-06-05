#!/usr/bin/env node
// classify-outreach-reply — classify an inbound message on an outreach thread and,
// for the reputation-critical classes, AUTO-SUPPRESS as a fail-safe.
//
// Two layers:
//   1. Deterministic detectors (authoritative — they OVERRIDE any human/LLM label):
//        hard_bounce · soft_bounce · complaint · auto_reply · unsubscribe
//      These are machine-readable (DSN/ARF headers, opt-out keywords). When one of
//      {hard_bounce, complaint, unsubscribe} fires, this skill writes the suppression
//      row ITSELF (unless --dry-run) so a missed agent step can never leak a resend.
//   2. Human-reply label: if no detector fires, the message is a real human reply and
//      needs semantic judgment the SDR (Sami) supplies via --llm-class
//      (yes|no|changes|ambiguous). 'no' is a FULL STOP per spec decision #2 → it also
//      auto-suppresses (reason=no_interest). Missing/invalid label → 'ambiguous' (safe
//      default → routes to the Board).
//
// This skill does NOT change the lead's stage or send anything — it returns a decision
// (reply_status, recommended_stage, send_auto_reply, alert_board, route) for the SDR to
// execute via lead-update / gmail-send / board-approval-create. The only side effect it
// owns is the suppression write (the one thing too risky to leave to agent memory).
//
// Invocation:
//   node run.mjs --from <a@b> --subject "..." --body "..." \
//     [--body-file p] [--raw-file p] [--lead-id id] [--lead-email a@b] \
//     [--message-id id] [--llm-class yes|no|changes|ambiguous] [--dry-run]
//
// Exit: 0 ok · 2 decision-needed (bad input) · 3 adapter-broken (no node:sqlite)

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  console.error(JSON.stringify({ error: "adapter-broken", reason: "node_sqlite_unavailable",
    detail: "Bind NODE_OPTIONS=--experimental-sqlite.", message: e.message }));
  process.exit(3);
}

function normEmail(s) { return String(s || "").trim().toLowerCase().replace(/^<|>$/g, ""); }
function domainOf(email) { const m = normEmail(email).match(/@(.+)$/); return m ? m[1] : ""; }
function firstEmailIn(s) { const m = String(s || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); return m ? normEmail(m[0]) : ""; }

// Inline suppression upsert — kept identical to suppression-add/run.mjs (self-contained,
// no cross-skill deploy dependency; keep these in sync).
function upsertSuppression(db, { value, scope, reason, leadId, messageId, notes }) {
  const v = scope === "domain" ? String(value).trim().toLowerCase() : normEmail(value);
  if (!v) return { created: false, value: v, scope, skipped: "empty value" };
  const existing = db.prepare("SELECT id FROM suppressions WHERE value=? AND scope=?").get(v, scope);
  if (existing) {
    db.prepare("UPDATE suppressions SET updated_at=datetime('now') WHERE id=?").run(existing.id);
    return { created: false, id: existing.id, value: v, scope };
  }
  const r = db.prepare(
    `INSERT INTO suppressions (value, scope, reason, lead_id, source_message_id, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(v, scope, reason, leadId || null, messageId || null, notes || null);
  return { created: true, id: r.lastInsertRowid, value: v, scope };
}

// ── Detectors ────────────────────────────────────────────────────────────────
// Each returns { class, signals } or null. Order = authority (machine first).

const BOUNCE_PERMANENT = /(user unknown|no such (user|mailbox|recipient)|mailbox (unavailable|not found|does not exist|is disabled)|address (rejected|not found|does not exist)|recipient (address )?rejected|does not exist|account (is )?(disabled|inactive|closed|discontinued)|user (is )?(unknown|disabled)|relay access denied|domain not found|no such (domain|host)|552|550[\s-]|554[\s-]|delivery has permanently failed)/i;
const BOUNCE_TRANSIENT = /(temporar(il)?y|over quota|quota exceeded|mailbox full|try again later|greylist|deferred|connection timed out|451[\s-]|452[\s-]|421[\s-]|4\.\d\.\d)/i;

function detectBounce(from, subject, hay, raw) {
  const sig = [];
  const fromBounce = /(mailer-?daemon|postmaster|mail-?delivery|mdaemon)@/i.test(from);
  if (fromBounce) sig.push(`from:${from}`);
  const subjBounce = /(undeliverable|delivery (status notification|has failed|failure)|failure notice|returned mail|mail delivery (failed|subsystem)|message (not delivered|could not be delivered)|delivery incomplete|delivery error)/i.test(subject);
  if (subjBounce) sig.push("subject:delivery-failure");
  const dsn = /(content-type:\s*(message\/delivery-status|multipart\/report)[^]*report-type=delivery-status|^(final|original)-recipient:|^diagnostic-code:|^action:\s*failed|^status:\s*[245]\.\d+\.\d+)/im.test(raw + "\n" + hay);
  if (dsn) sig.push("dsn-headers");
  if (!fromBounce && !subjBounce && !dsn) return null;

  // Capture an SMTP/DSN status class to decide hard vs soft.
  const statusMatch = (raw + "\n" + hay).match(/^status:\s*([245])\.\d+\.\d+/im) || (raw + "\n" + hay).match(/\b([245])\d\d[\s-]\d\.\d\.\d\b/);
  const cls = statusMatch ? statusMatch[1] : null;
  const permanent = cls === "5" || BOUNCE_PERMANENT.test(hay) || BOUNCE_PERMANENT.test(raw);
  const transient = cls === "4" || (BOUNCE_TRANSIENT.test(hay) && !permanent);
  if (cls) sig.push(`status-class:${cls}xx`);
  if (permanent && !transient) { sig.push("permanent-failure"); return { class: "hard_bounce", signals: sig }; }
  if (transient) { sig.push("transient-failure"); return { class: "soft_bounce", signals: sig }; }
  // Bounce detected but permanence unclear → treat as SOFT (do NOT auto-suppress a maybe-good lead).
  sig.push("permanence-unknown→soft");
  return { class: "soft_bounce", signals: sig };
}

function detectComplaint(from, subject, hay, raw) {
  const sig = [];
  if (/report-type=feedback-report/i.test(raw) || /content-type:\s*message\/feedback-report/i.test(raw)) sig.push("arf-feedback-report");
  if (/(abuse|complaints?|feedback-loop|fbl)@/i.test(from)) sig.push(`from:${from}`);
  if (/(spam (complaint|report)|abuse (report|complaint)|reported as spam|this is a spam)/i.test(subject + " " + hay)) sig.push("subject/body:spam-complaint");
  return sig.length ? { class: "complaint", signals: sig } : null;
}

function detectAutoReply(subject, hay, raw) {
  const sig = [];
  if (/^(auto-submitted:\s*auto-(replied|generated)|x-auto(reply|respond|-response-suppress)|precedence:\s*(auto_reply|bulk|junk))/im.test(raw)) sig.push("auto-header");
  if (/(out of (the )?office|auto[\s-]?reply|automatic reply|on vacation|away from (my )?(desk|office|email)|currently (away|unavailable|out)|will be (out|away|back)|maternity leave|on (holiday|leave|pto)|reduced hours)/i.test(subject + " " + hay)) sig.push("ooo-phrasing");
  return sig.length ? { class: "auto_reply", signals: sig } : null;
}

function detectUnsubscribe(subject, body) {
  const t = String(body || "").trim().toLowerCase();
  if (/^(stop|stop\.|unsubscribe|remove me|opt[\s-]?out|no thanks?,? stop)$/.test(t)) return { class: "unsubscribe", signals: ["body==opt-out"] };
  if (/\b(unsubscribe|opt[\s-]?out|remove me from|take me off (your|the)|stop emailing|stop contacting|stop sending|do not (contact|email|message) me( again)?|don'?t (contact|email) me|leave me alone|no longer (wish|want) to (receive|be contacted)|get me off (your|this) list)\b/i.test(subject + " " + body)) {
    return { class: "unsubscribe", signals: ["opt-out-phrase"] };
  }
  return null;
}

// ── Decision mapping ─────────────────────────────────────────────────────────
const DECISION = {
  hard_bounce: { reply_status: "bounced",   suppress: "hard_bounce", stage: "lost",                alert: false, route: "Hard bounce — address suppressed; mark lead lost. Do NOT resend." },
  soft_bounce: { reply_status: "soft_bounce", suppress: null,         stage: null,                  alert: false, route: "Transient bounce — NOT suppressed. Leave lead as-is; cadence may retry later." },
  complaint:   { reply_status: "complaint", suppress: "complaint",   stage: "lost",                alert: true,  route: "SPAM COMPLAINT — address suppressed immediately. High-priority Discord reputation alert to Ryan." },
  unsubscribe: { reply_status: "unsubscribed", suppress: "unsubscribe", stage: "closed_unsubscribed", alert: false, route: "Unsubscribe — address suppressed; lead closed_unsubscribed. No reply sent." },
  auto_reply:  { reply_status: "auto_reply", suppress: null,         stage: null,                  alert: false, route: "Auto-reply / out-of-office — not a real reply. No state change; leave any drip running." },
  positive:    { reply_status: "positive",  suppress: null,          stage: "qualifying",          alert: true,  route: "YES — send PATH 1 auto-reply (gated until warm-up), alert Ryan, lead → qualifying.", auto_reply: true },
  negative:    { reply_status: "negative",  suppress: "no_interest", stage: "closed_no_interest",  alert: false, route: "NO — full stop (decision #2). Address suppressed; lead closed_no_interest. No soft-no email." },
  changes:     { reply_status: "changes",   suppress: null,          stage: "qualifying",          alert: true,  route: "YES-BUT-WANTS-CHANGES — own lane. Capture edits, alert Ryan, rebuild/redeploy via Lovable on his OK. Do NOT bury in ambiguous." },
  ambiguous:   { reply_status: "ambiguous", suppress: null,          stage: "replied",             alert: true,  route: "AMBIGUOUS — file a Tier-1 Board approval Issue with the message body, classifier evidence, and 3 candidate drafts. Board decides." },
};

async function main() {
  const { values } = parseArgs({ options: {
    from: { type: "string" }, subject: { type: "string" }, body: { type: "string" },
    "body-file": { type: "string" }, "raw-file": { type: "string" },
    "lead-id": { type: "string" }, "lead-email": { type: "string" }, "message-id": { type: "string" },
    "llm-class": { type: "string" }, "dry-run": { type: "boolean" },
  } });

  const from = normEmail(values.from);
  const subject = values.subject || "";
  let body = values.body || "";
  if (values["body-file"]) { try { body = readFileSync(values["body-file"], "utf8"); } catch { /* keep arg */ } }
  let raw = "";
  if (values["raw-file"]) { try { raw = readFileSync(values["raw-file"], "utf8"); } catch { /* optional */ } }
  const hay = `${subject}\n${body}`;

  if (!from && !subject && !body) {
    console.error(JSON.stringify({ error: "decision-needed", reason: "need at least --from/--subject/--body" }));
    process.exit(2);
  }

  // Run detectors in authority order.
  const det = detectBounce(from, subject, hay, raw)
           || detectComplaint(from, subject, hay, raw)
           || detectAutoReply(subject, hay, raw)
           || detectUnsubscribe(subject, body);

  let klass, signals, source;
  if (det) { klass = det.class; signals = det.signals; source = "detector"; }
  else {
    // Human reply — use the SDR's semantic label.
    const raw_label = (values["llm-class"] || "").trim().toLowerCase();
    const map = { yes: "positive", positive: "positive", no: "negative", negative: "negative",
                  changes: "changes", "yes-but": "changes", ambiguous: "ambiguous", "": "ambiguous" };
    klass = map[raw_label] || "ambiguous";
    signals = raw_label && map[raw_label] ? [`llm-class:${raw_label}`] : ["llm-class:absent→ambiguous"];
    source = "llm-label";
  }

  const d = DECISION[klass];
  // The address we must never email again = the lead's address we contacted.
  // Bounces name the failed recipient in the DSN; otherwise the reply comes FROM the lead.
  const failedRecip = klass.endsWith("bounce")
    ? (firstEmailIn((raw.match(/^(final|original)-recipient:.*$/im) || [""])[0]) ||
       firstEmailIn((raw.match(/^x-failed-recipients:.*$/im) || [""])[0]))
    : "";
  const target = normEmail(values["lead-email"]) || failedRecip || from;

  let suppressed = null;
  if (d.suppress && !values["dry-run"]) {
    if (!target || !/@/.test(target)) {
      suppressed = { created: false, skipped: "no target email to suppress" };
    } else {
      const db = new DatabaseSync(process.env.LEADS_DB_PATH || "/home/paperclip/vantyx-leads.sqlite");
      suppressed = upsertSuppression(db, {
        value: target, scope: "email", reason: d.suppress,
        leadId: values["lead-id"], messageId: values["message-id"],
        notes: `auto via classify-outreach-reply (${klass})`,
      });
      db.close();
    }
  }

  console.log(JSON.stringify({
    class: klass,
    source,
    confidence: source === "detector" ? "high" : (signals[0].includes("absent") ? "low" : "medium"),
    reply_status: d.reply_status,
    recommended_stage: d.stage,
    suppress: d.suppress || null,
    suppressed,                      // null if nothing written, else {created,...}
    send_auto_reply: !!d.auto_reply, // PATH 1 only; caller keeps gated until warm-up
    alert_board: d.alert,
    route: d.route,
    signals,
    suppress_target: d.suppress ? target : null,
    lead_id: values["lead-id"] || null,
    message_id: values["message-id"] || null,
    dry_run: !!values["dry-run"],
  }));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("run.mjs")) {
  main().catch((e) => { console.error(JSON.stringify({ error: "unknown-failure", message: e.message })); process.exit(1); });
}
