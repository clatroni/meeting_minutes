"""Feedback loop — turn user feedback into Rules.docx amendments.

Workflow (called from ui.py):
  1. User rates a generated MoM (👍 / 👎) and optionally adds a comment
     describing what should be different.
  2. log_feedback() appends the entry to feedback/log.jsonl.
  3. If a comment was provided AND ANTHROPIC_API_KEY is set,
     propose_rule_amendment() asks Claude to convert the comment into a
     single new rule (one sentence) in the same style as the existing rules.
  4. The user reviews the proposed rule in the UI; on "Apply" the rule is
     appended to Rules.docx via apply_rule_amendment().

This gives the tool a genuine continuous-learning loop: every piece of
feedback can permanently change how future MoMs are written.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FEEDBACK_DIR = ROOT / "feedback"
FEEDBACK_LOG = FEEDBACK_DIR / "log.jsonl"


# ============================================================
# Logging
# ============================================================
def log_feedback(entry: dict) -> Path:
    """Append a feedback entry to feedback/log.jsonl. Returns the log path."""
    FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    entry = {"timestamp": datetime.now().isoformat(timespec="seconds"), **entry}
    with FEEDBACK_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return FEEDBACK_LOG


def recent_feedback(limit: int = 10) -> list[dict]:
    if not FEEDBACK_LOG.exists():
        return []
    lines = FEEDBACK_LOG.read_text(encoding="utf-8").splitlines()
    out = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return list(reversed(out))


def feedback_stats() -> dict:
    """Return basic counts for the UI."""
    if not FEEDBACK_LOG.exists():
        return {"total": 0, "thumbs_up": 0, "thumbs_down": 0, "applied": 0}
    up = down = applied = total = 0
    for line in FEEDBACK_LOG.read_text(encoding="utf-8").splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        total += 1
        if e.get("rating") == "thumbs_up":
            up += 1
        elif e.get("rating") == "thumbs_down":
            down += 1
        if e.get("rule_amendment_applied"):
            applied += 1
    return {"total": total, "thumbs_up": up, "thumbs_down": down, "applied": applied}


# ============================================================
# Claude-powered rule-amendment proposal
# ============================================================
PROPOSE_SYSTEM = """You are a senior consulting Engagement Manager curating the team's MoM Writing Rules document.

You will receive:
  - A snippet of the current Rules.docx text
  - A piece of user feedback describing what should be different in future Meeting Minutes

Your job: propose ONE new rule (one or two sentences max) to add to the rules document so the issue raised in the feedback never happens again.

Constraints:
  - Use the same imperative consulting tone as the existing rules.
  - Be specific and actionable. No fluff.
  - Format: a short bold-ready label (e.g. 'Action items — include client name'), followed by ' — ', followed by the rule text.
  - Return ONLY the new rule line (label + em-dash + body). No explanation, no quoting, no markdown."""


def propose_rule_amendment(feedback_comment: str, current_rules_text: str) -> str | None:
    """Ask Claude to convert user feedback into a new rule.

    Returns the proposed rule text (one line: 'Label — Body') or None if
    no API key is set or the call fails.
    """
    if not feedback_comment or not feedback_comment.strip():
        return None
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None

    try:
        import anthropic
    except ImportError:
        return None

    try:
        client = anthropic.Anthropic()
        model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
        # Keep cost low — we don't need the entire rules doc, only enough for tone-match
        rules_excerpt = current_rules_text[:4000]

        resp = client.messages.create(
            model=model,
            max_tokens=300,
            temperature=0.2,
            system=PROPOSE_SYSTEM,
            messages=[{
                "role": "user",
                "content": (
                    f"Existing rules (excerpt for tone reference):\n---\n{rules_excerpt}\n---\n\n"
                    f"User feedback on the most recent MoM:\n---\n{feedback_comment.strip()}\n---\n\n"
                    f"Propose one new rule to add to the document."
                ),
            }],
        )
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                text = (block.text or "").strip()
                # Drop any wrapping quotes the model might add
                if text.startswith(('"', "'")):
                    text = text.strip("\"'")
                return text or None
    except Exception:
        return None
    return None


# ============================================================
# Apply an amendment to Rules.docx
# ============================================================
def apply_rule_amendment(amendment: str, *, rules_path: Path | None = None) -> Path:
    """Append a new rule line to Rules.docx, preserving the existing structure.

    The amendment is added under a special 'Step 3 — Continuous improvements'
    section so it's clearly distinct from the canonical rules and easy to
    reset (re-running _build_inputs.py rebuilds the canonical rules and
    drops Step 3, but the user is warned in the UI).
    """
    from run import _load_rules_from, save_rules_text, RULES_DOC

    target = rules_path or RULES_DOC
    current = _load_rules_from(target)

    section_header = "Step 3 — Continuous improvements (added from user feedback)"
    if section_header not in current:
        current = current.rstrip() + f"\n\n{section_header}\n"
    current = current.rstrip() + f"\n{amendment.strip()}\n"

    save_rules_text(current, target)
    return target
