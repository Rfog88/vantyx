#!/usr/bin/env node
// board-notify — Discord + (optional) Twilio SMS notification primitive.
// Invocation:
//   echo '{"tier":1,"title":"...","body":"..."}' | node skills/board-notify/run.mjs

import { readFileSync } from "node:fs";

function inDndWindow() {
  const win = process.env.BOARD_DND_HOURS;
  if (!win) return false;
  const m = win.match(/^(\d{2})-(\d{2})$/);
  if (!m) return false;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  const now = new Date();
  const hour = now.getHours();
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;   // wraps midnight
}

async function postDiscord(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`discord webhook ${res.status} ${await res.text()}`);
  }
}

async function sendTwilioSms(body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.BOARD_PHONE;
  if (!sid || !token || !from || !to) {
    return { status: "skipped", reason: "twilio_not_configured" };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const form = new URLSearchParams({ From: from, To: to, Body: body });
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) return { status: "error", code: res.status, body: await res.text() };
  return { status: "sent" };
}

async function main() {
  const raw = readFileSync(0, "utf8");
  let input;
  try { input = JSON.parse(raw); }
  catch { console.error(JSON.stringify({ error: "decision-needed", reason: "invalid_json_input" })); process.exit(2); }

  const { tier = 0, title = "", body = "", issue_url, sms_on_tier_2 = true } = input;
  const dnd = inDndWindow();

  if (tier === 0 && dnd) {
    console.log(JSON.stringify({ discord: "skipped_dnd", sms: "skipped" }));
    return;
  }
  if (tier === 1 && dnd) {
    // TODO Phase 2: queue for window-end. For now, hold in lessons.md so it's not lost.
    console.log(JSON.stringify({ discord: "deferred_dnd", sms: "skipped" }));
    return;
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error(JSON.stringify({ error: "api-key-missing", service: "discord_webhook" }));
    process.exit(3);
  }

  const tierTag = tier === 2 ? "[HARD-BLOCK]" : tier === 1 ? "[DECISION]" : "[STATUS]";
  const mention = tier === 2 ? "@here " : "";
  const ackHint = tier >= 1 ? "\n\nReact \u{1f44d} or reply ACK to acknowledge." : "";
  const issueLine = issue_url ? `\n\nIssue: ${issue_url}` : "";

  await postDiscord(webhookUrl, {
    content: `${mention}**${tierTag} ${title}**\n${body}${issueLine}${ackHint}`,
  });

  let smsResult = { status: "skipped", reason: "tier<2" };
  if (tier === 2 && sms_on_tier_2) {
    smsResult = await sendTwilioSms(`[VANTYX HARD-BLOCK] ${title} — ${body.substring(0, 100)}`);
  }

  console.log(JSON.stringify({ discord: "ok", sms: smsResult.status }));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "unknown-failure", message: e.message }));
  process.exit(1);
});
