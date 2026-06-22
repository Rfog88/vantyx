#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const VALID = new Set(["positive", "negative", "unsubscribe", "ambiguous"]);

class ClassifierError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "ClassifierError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = {}, exitCode = 2) {
  console.error(JSON.stringify({ error: code, message, ...detail }));
  process.exit(exitCode);
}

function readInput() {
  const raw = readFileSync(0, "utf8");
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new ClassifierError("decision-needed", "invalid_json_input");
  }
  const from = String(input.from || "").trim();
  const subject = String(input.subject || "").trim();
  const body_text = String(input.body_text || "");
  const original_outreach_body = typeof input.original_outreach_body === "string" ? input.original_outreach_body : "";

  if (!from || !subject || !body_text.trim()) {
    throw new ClassifierError("decision-needed", "missing_required_fields", {
      required: ["from", "subject", "body_text"],
    });
  }

  return { from, subject, body_text, original_outreach_body };
}

function buildPrompt(input) {
  const system = [
    "You are an outbound-sales email reply classifier.",
    "Classify the inbound reply into exactly one label: positive, negative, unsubscribe, ambiguous.",
    "Return ONLY strict JSON with keys: classification, confidence, evidence, suggested_response.",
    "confidence is a number between 0 and 1.",
    "evidence must be an exact verbatim substring from body_text that drove the classification.",
    "Use suggested_response only for ambiguous replies; otherwise omit or set null.",
    "No markdown, no prose, no code fences.",
  ].join(" ");

  return [
    system,
    "",
    `from: ${input.from}`,
    `subject: ${input.subject}`,
    "",
    "original_outreach_body:",
    input.original_outreach_body || "(not provided)",
    "",
    "body_text:",
    input.body_text,
  ].join("\n");
}

function parseClaudeStreamJson(stdout) {
  let finalResult = null;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const evt = JSON.parse(line);
      if (evt && evt.type === "result") finalResult = evt;
    } catch {
      // ignore non-JSON lines
    }
  }
  return finalResult;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function callClaude(prompt) {
  const cmd = process.env.CLASSIFY_OUTREACH_REPLY_CLAUDE_CMD || "claude";
  const model = process.env.CLASSIFY_OUTREACH_REPLY_CLAUDE_MODEL || "";
  const timeoutMs = Number(process.env.CLASSIFY_OUTREACH_REPLY_TIMEOUT_MS || "90000");

  const args = ["--print", "-", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
  if (model) args.push("--model", model);

  const proc = spawnSync(cmd, args, {
    input: prompt,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (proc.error) {
    throw new ClassifierError("adapter-broken", "claude_invocation_failed", { detail: proc.error.message });
  }
  if (proc.status !== 0) {
    throw new ClassifierError("adapter-broken", "claude_nonzero_exit", {
      exit_code: proc.status,
      stderr: (proc.stderr || "").trim().slice(0, 1200),
    });
  }

  const streamResult = parseClaudeStreamJson(proc.stdout || "");
  const text = streamResult?.result || (proc.stdout || "").trim();
  return text;
}

function normalizeParsed(parsed, bodyText) {
  if (!parsed || typeof parsed !== "object") {
    throw new ClassifierError("parse-failure", "model_output_not_json_object");
  }

  const classification = String(parsed.classification || "").trim();
  const confidence = Number(parsed.confidence);
  const evidence = String(parsed.evidence || "");
  const suggested = typeof parsed.suggested_response === "string" ? parsed.suggested_response.trim() : "";

  if (!VALID.has(classification)) {
    throw new ClassifierError("parse-failure", "invalid_classification", { got: classification });
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new ClassifierError("parse-failure", "invalid_confidence", { got: parsed.confidence });
  }
  if (!evidence || !bodyText.includes(evidence)) {
    throw new ClassifierError("parse-failure", "invalid_evidence_not_verbatim_substring", {
      evidence,
    });
  }

  let outClassification = classification;
  let outEvidence = evidence;

  if (confidence < 0.9) {
    outClassification = "ambiguous";
    outEvidence = `${evidence} | Confidence floor override: ${confidence.toFixed(2)} < 0.90, forced ambiguous.`;
  }

  const out = {
    classification: outClassification,
    confidence,
    evidence: outEvidence,
  };

  if (outClassification === "ambiguous" && suggested) {
    out.suggested_response = suggested;
  }

  return out;
}

function classifyStub(input) {
  const body = input.body_text;
  const t = body.toLowerCase();
  const pick = (re) => {
    const m = body.match(re);
    return m ? m[0] : body.split(/\s+/).slice(0, 6).join(" ");
  };

  if (/\b(stop|unsubscribe|remove me|opt out|do not contact)\b/.test(t)) {
    return { classification: "unsubscribe", confidence: 0.99, evidence: pick(/\b(stop|unsubscribe|remove me|opt out|do not contact)\b/i) };
  }
  if (/\b(not interested|no thanks|pass|don't contact)\b/.test(t)) {
    return { classification: "negative", confidence: 0.97, evidence: pick(/\b(not interested|no thanks|pass|don't contact)\b/i) };
  }
  if (/\b(yes|sounds good|send photos|let'?s do it|interested)\b/.test(t) && !/\bprice|cost|how much|question\b/.test(t)) {
    return { classification: "positive", confidence: 0.96, evidence: pick(/\b(yes|sounds good|send photos|let'?s do it|interested)\b/i) };
  }
  if (/\b(half in|maybe|possibly|could work)\b/.test(t)) {
    return {
      classification: "positive",
      confidence: 0.88,
      evidence: pick(/\b(half in|maybe|possibly|could work)\b/i),
      suggested_response: "Happy to help. Want me to send one quick concept and pricing range?",
    };
  }

  return {
    classification: "ambiguous",
    confidence: 0.91,
    evidence: input.body_text.split(/\s+/).slice(0, 6).join(" "),
    suggested_response: "Thanks for the reply. Could you confirm if you'd like a quick concept demo or want pricing details first?",
  };
}

async function main() {
  const input = readInput();
  const stub = process.env.CLASSIFY_OUTREACH_REPLY_STUB === "1";

  let rawModelOutput;
  if (stub) {
    rawModelOutput = JSON.stringify(classifyStub(input));
  } else {
    const prompt = buildPrompt(input);
    rawModelOutput = callClaude(prompt);
  }

  const parsed = safeJsonParse(rawModelOutput);
  if (!parsed) {
    throw new ClassifierError("parse-failure", "model_output_not_valid_json", {
      raw_output_excerpt: rawModelOutput.slice(0, 800),
    });
  }

  const out = normalizeParsed(parsed, input.body_text);
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

main().catch((err) => {
  if (err instanceof ClassifierError) {
    const codeToExit = err.code === "parse-failure" ? 4 : err.code === "adapter-broken" ? 5 : 2;
    fail(err.code, err.message, err.detail, codeToExit);
  }
  fail("unknown-failure", err?.message || String(err), {}, 1);
});
