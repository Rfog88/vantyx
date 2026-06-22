---
schema: agentcompanies/v1
kind: skill
name: classify-outreach-reply
description: Classify one inbound outreach reply into positive, negative, unsubscribe, or ambiguous via the company's Claude local path.
metadata:
  requires_env:
    - CLASSIFY_OUTREACH_REPLY_CLAUDE_CMD   # optional; default "claude"
    - CLASSIFY_OUTREACH_REPLY_CLAUDE_MODEL # optional
    - CLASSIFY_OUTREACH_REPLY_STUB         # optional test mode (1=true)
  implementation: skills/classify-outreach-reply/run.mjs
  primary_users: [sdr, cmo]
---

# classify-outreach-reply

Classifies a single inbound email reply into exactly one of:

- `positive`
- `negative`
- `unsubscribe`
- `ambiguous`

## Input

```json
{
  "from": "prospect@example.com",
  "subject": "Re: Quick concept demo",
  "body_text": "...",
  "original_outreach_body": "... optional ..."
}
```

## Return

```json
{
  "classification": "positive | negative | unsubscribe | ambiguous",
  "confidence": 0.97,
  "evidence": "exact phrase from body_text",
  "suggested_response": "... optional, only when ambiguous ..."
}
```

## Rules

- Claude must return JSON only.
- `evidence` must quote a verbatim substring from `body_text`.
- Confidence floor: if Claude confidence is `< 0.9`, final classification is forced to `ambiguous`.
- `suggested_response` is omitted unless final classification is `ambiguous`.
