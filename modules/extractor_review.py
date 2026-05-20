"""
extractor_review.py
Second Claude pass that audits the first MoM extraction against the transcript
and returns a corrected version with the SAME JSON schema. The review pass
catches: missed actions hidden in volunteer/command patterns, mis-classified
ongoing actions marked Completed, missing rationales on decisions, duplicate
items, and pleasantries that leaked into topics.

Pattern is borrowed from MichalisPanousos/meeting-minutes (the only meaningful
architectural innovation over the single-pass design).
"""

import json
import logging

log = logging.getLogger(__name__)


REVIEW_SYSTEM = """You are a senior PMO quality reviewer auditing draft Meeting Minutes.
You are given:
  1) The cleaned meeting transcript
  2) A first-pass extraction in JSON

Your job: return a CORRECTED full JSON with the SAME schema. Apply the audit below, in order.

=== TEAM RULES (must be respected) ===
{rules}
=== END TEAM RULES ===

=== AUDIT STEPS ===

STEP 1 — ACTION ITEMS (highest priority)
Strict classification rules:
  - If evidence contains future markers ("will", "I'll", "θα", "να", "πρέπει", imperative form) and no past completion verb → status = "Not Started" or "In Progress", NEVER "Completed".
  - "Completed" requires explicit past-tense completion ("done", "sent", "ολοκλήρωσα", "έστειλα").
  - If in doubt → "Not Started".

Patterns the first pass often misses — add them as action items:
  - Command + acceptance: "Send me the file" + "OK" → action on the person who said OK.
  - Volunteer + confirmation: "Should I do it?" + "Yes" → action on the volunteer.
  - Personal commitment: "I'll look at it", "θα το κοιτάξω" → action on the speaker.
  - Direct assignment by name: "Kosta, do X" → action on Kostas.

Owner rules:
  - Owners MUST be full names matching the participants list when possible.
  - Never just a first name unless the participant entry is also first-name-only.
  - Unknown → use "TBD" (do not invent names).

STEP 2 — DECISIONS
  - Only agreed decisions belong here — not discussions or musings.
  - Strip pleasantry prefixes ("OK", "Agreed,", "Συμφωνώ,") — keep only the substance.
  - Add a missed decision if the transcript clearly shows agreement that isn't logged.

STEP 3 — EXECUTIVE SUMMARY
  - 4-8 sentences of real prose.
  - Order: situation → key decisions → risks → next milestone.
  - NEVER write meta-narration like "5 attendees made 110 contributions". Strip such phrasing.

STEP 4 — TOPICS
  - Cover what was discussed AND what was concluded — not who said what.
  - Merge duplicates; remove pleasantries-only topics.

STEP 5 — RISKS & ISSUES
  - Risk = future threat; Issue = current problem.
  - Only Amber/Red items (blockers, missing sign-off, delays, missing resources).
  - Do NOT duplicate something already captured as an action.

STEP 6 — NORMALIZATION
  - Empty strings, "N/A", "—" are forbidden — use "TBD" or "Unknown".
  - Enums must match exactly: priority ∈ {{High, Medium, Low}}, status ∈ {{Not Started, In Progress, Completed}}, risk type ∈ {{Risk, Issue}}.
  - Action descriptions: verb-led, under 18 words, no filler ("Let's", "I think we should").

OUTPUT
Submit the CORRECTED minutes via the `submit_minutes` tool. Return the FULL JSON, not just the diff."""


def review_extraction(rules, cleaned, transcript_text, first_extraction,
                      *, schema, model=None, temperature=0.0, max_tokens=8000):
    """
    Run a Claude review pass over an existing extraction.

    Returns the corrected JSON. If the review call fails for any reason,
    re-raises so the caller can decide to keep the first extraction.
    """
    import os
    import anthropic

    client = anthropic.Anthropic()
    model = model or os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    user_msg = (
        f"Speakers detected: {', '.join(cleaned.get('speakers', []))}\n"
        f"Title hint: {cleaned.get('title_hint') or '(none)'}\n"
        f"Date hint: {cleaned.get('date_hint') or '(none)'}\n\n"
        f"=== TRANSCRIPT ===\n{transcript_text}\n=== END TRANSCRIPT ===\n\n"
        f"=== FIRST EXTRACTION (JSON) ===\n"
        f"{json.dumps(first_extraction, ensure_ascii=False, indent=2)}\n"
        f"=== END FIRST EXTRACTION ==="
    )

    log.info(f"Review pass: Claude ({model}, temp={temperature})...")
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=REVIEW_SYSTEM.format(rules=rules),
        tools=[{"name": "submit_minutes",
                "description": "Submit the CORRECTED Meeting Minutes after audit.",
                "input_schema": schema}],
        tool_choice={"type": "tool", "name": "submit_minutes"},
        messages=[{"role": "user", "content": user_msg}],
    )
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use":
            return block.input
    raise RuntimeError("Review pass: Anthropic did not return the expected tool_use block")
