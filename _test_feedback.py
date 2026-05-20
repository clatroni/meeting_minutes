"""End-to-end test for the continuous-learning feedback loop.

Run:
    python _test_feedback.py

Proves five things, with no API key required:

  1. Feedback entries are logged correctly to feedback/log.jsonl.
  2. A rule amendment can be applied to Rules.docx (using a hardcoded amendment
     to bypass the Claude proposal step — the proposal is just a convenience).
  3. The new rule survives the docx round-trip and is loadable via _load_rules_from.
  4. The new rule is part of the effective system prompt that would be sent to
     Claude on the very next generation (so the model would follow it).
  5. Re-running _build_inputs.py cleanly wipes the user-added rules (reset path).

If the API key IS set, Test 6 also runs and verifies that propose_rule_amendment
actually calls Claude and returns a sensible rule line.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RULES_DOC = ROOT / "input" / "Rules.docx"
FEEDBACK_LOG = ROOT / "feedback" / "log.jsonl"

GREEN = "\033[92m"
RED = "\033[91m"
GRAY = "\033[90m"
RESET = "\033[0m"


def section(title: str) -> None:
    print(f"\n{GRAY}{'=' * 70}{RESET}")
    print(f"{title}")
    print(f"{GRAY}{'=' * 70}{RESET}")


def check(label: str, passed: bool, detail: str = "") -> bool:
    mark = f"{GREEN}PASS{RESET}" if passed else f"{RED}FAIL{RESET}"
    line = f"  [{mark}] {label}"
    if detail:
        line += f"  {GRAY}{detail}{RESET}"
    print(line)
    return passed


def main() -> int:
    from _feedback import (
        FEEDBACK_LOG as FB_LOG,
        apply_rule_amendment,
        feedback_stats,
        log_feedback,
        propose_rule_amendment,
        recent_feedback,
    )
    from run import _load_rules_from, RULES_DOC as RULES_DOC_RUN

    all_passed = True

    # Reset state — clean log, regenerate canonical Rules.docx
    section("Setup — clean slate")
    if FB_LOG.exists():
        FB_LOG.unlink()
    print("  feedback/log.jsonl cleared")
    subprocess.run([sys.executable, str(ROOT / "_build_inputs.py")], check=True, capture_output=True)
    print("  Rules.docx regenerated to canonical defaults")
    baseline_text = _load_rules_from(RULES_DOC_RUN)
    print(f"  Baseline Rules.docx: {len(baseline_text)} chars")

    # ----- Test 1: Logging -----
    section("Test 1 — feedback entries are logged")
    log_feedback({"transcript": "demo.docx", "rating": "thumbs_up", "comment": ""})
    log_feedback({"transcript": "demo.docx", "rating": "thumbs_down",
                  "comment": "Action items should always reference the client name."})
    stats = feedback_stats()
    all_passed &= check("Two entries written to log", stats["total"] == 2,
                        f"total={stats['total']}, up={stats['thumbs_up']}, down={stats['thumbs_down']}")
    rec = recent_feedback(2)
    all_passed &= check("Most-recent entry has the comment we just submitted",
                        rec[0].get("comment") == "Action items should always reference the client name.")

    # ----- Test 2: Apply an amendment -----
    section("Test 2 — amendment applied to Rules.docx")
    test_rule = ("Action items — client name — When the meeting concerns a specific client engagement, "
                 "every action item description must reference the client by name "
                 "(e.g., 'Send Enerwave the updated KPI spec').")
    apply_rule_amendment(test_rule)
    new_text = _load_rules_from(RULES_DOC_RUN)
    all_passed &= check("Step 3 section now exists in Rules.docx",
                        "Step 3 — Continuous improvements" in new_text)
    all_passed &= check("New rule line is present in Rules.docx",
                        "every action item description must reference the client by name" in new_text)
    all_passed &= check("Rules.docx grew (length increased)",
                        len(new_text) > len(baseline_text),
                        f"before={len(baseline_text)}, after={len(new_text)}")

    # ----- Test 3: Round-trip — _load_rules_from re-reads it -----
    section("Test 3 — the new rule survives the docx round-trip")
    reloaded = _load_rules_from(RULES_DOC_RUN)
    all_passed &= check("Reloaded text contains the rule",
                        "every action item description must reference the client by name" in reloaded)

    # ----- Test 4: Effective system prompt would include the new rule -----
    section("Test 4 — the AI's next system prompt includes the new rule")
    from run import SYSTEM_PROMPT_BASE, TONE_PRESETS
    rules_text_for_prompt = _load_rules_from(RULES_DOC_RUN)
    effective_prompt = SYSTEM_PROMPT_BASE.format(rules=rules_text_for_prompt, tone_block=TONE_PRESETS["default"])
    all_passed &= check("System prompt contains the canonical rules header",
                        "=== TEAM RULES ===" in effective_prompt)
    all_passed &= check("System prompt contains the new feedback rule",
                        "every action item description must reference the client by name" in effective_prompt)
    all_passed &= check("System prompt contains Step 3 marker",
                        "Step 3 — Continuous improvements" in effective_prompt)

    # ----- Test 5: Reset path -----
    section("Test 5 — _build_inputs.py cleanly resets the rules")
    subprocess.run([sys.executable, str(ROOT / "_build_inputs.py")], check=True, capture_output=True)
    after_reset = _load_rules_from(RULES_DOC_RUN)
    all_passed &= check("After reset, the new rule is gone",
                        "every action item description must reference the client by name" not in after_reset)
    all_passed &= check("After reset, length matches baseline",
                        len(after_reset) == len(baseline_text),
                        f"baseline={len(baseline_text)}, after_reset={len(after_reset)}")

    # ----- Test 6: AI proposal (only if API key is set) -----
    if os.environ.get("ANTHROPIC_API_KEY"):
        section("Test 6 — Claude proposes a sensible rule amendment")
        proposed = propose_rule_amendment(
            "The Decisions section should always include a one-line rationale, even if obvious.",
            baseline_text,
        )
        all_passed &= check("Claude returned a non-empty amendment", bool(proposed),
                            f"proposed: {(proposed or '')[:80]}…")
        all_passed &= check("Amendment is short (< 400 chars)",
                            (proposed or "") and len(proposed) < 400,
                            f"len={len(proposed or '')}")
        all_passed &= check("Amendment looks like a rule line ('Label — body')",
                            (proposed or "").count("—") >= 1 or (proposed or "").count(" - ") >= 1)
    else:
        section("Test 6 — skipped (no ANTHROPIC_API_KEY in env)")
        print(f"  {GRAY}Set ANTHROPIC_API_KEY in .env to also exercise the Claude-proposal path.{RESET}")

    # ----- Summary -----
    section("Summary")
    if all_passed:
        print(f"  {GREEN}All checks passed.{RESET}  The continuous-learning loop works end-to-end:")
        print("    feedback logged → rule applied → docx round-tripped → AI prompt updated → reset works.")
        return 0
    else:
        print(f"  {RED}Some checks failed.{RESET}  Investigate the FAIL lines above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
