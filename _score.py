"""Quality scorer for the AI Meeting Minutes Generator.

Runs every sample in input/transcript/ through the pipeline and scores each
generated MoM on four dimensions:

  STRUCTURE (40%) — does every required field exist and is it well-formed?
  COVERAGE  (40%) — were the key facts from the transcript captured?
  HYGIENE   (20%) — is the prose clean? no filler, no duplicates, concise?
  LLM JUDGE (opt) — Claude grades the MoM 1-10 on tone/completeness/accuracy/structure

Final deterministic score = weighted average of the first three (0-100).
LLM score is reported separately when --llm is set (and ANTHROPIC_API_KEY is available).

Usage:
    python _score.py                            # auto provider, deterministic only
    python _score.py --provider rule_based      # force the offline path (baseline)
    python _score.py --llm                      # also run Claude as a judge
"""
from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path

from run import process_one, _load_rules_from

ROOT = Path(__file__).parent
SAMPLES_DIR = ROOT / "input" / "transcript"
OUTPUT = ROOT / "output"

# ============================================================
# Per-sample ground truth — what every good MoM for these calls MUST capture.
# Strings are case-insensitive substrings.
# ============================================================
EXPECTED: dict[str, dict] = {
    "01_Enerwave_Portfolio_Sync.docx": {
        "attendees": ["Christina Latroni", "Nikos Vasileiou", "Sofia Mitropoulou", "Alex Petrou", "Yannis Karagiannis"],
        "actions_keywords": ["weather API", "ServiceNow", "spec", "go/no-go", "ESG", "Power BI"],
        "decisions_keywords": ["split", "net", "ESG"],
        "dates_keywords": ["May 22", "June 10", "June 18", "May 15"],
        "risks_keywords": ["June 10", "weather", "demo"],
        "topics_keywords": ["KPI", "data sources", "rollout"],
    },
    "02_ERB_NUC_Billing_Weekly.docx": {
        "attendees": ["Christina Latroni", "Maria Papadopoulou", "Dimitris Antoniou", "Yannis Karagiannis"],
        "actions_keywords": ["rounding", "remap", "deck", "dry run", "CFO"],
        "decisions_keywords": ["remap", "threshold"],
        "dates_keywords": ["May 12", "May 14", "May 18", "Friday"],
        "risks_keywords": ["amber", "rounding", "CFO"],
        "topics_keywords": ["UAT", "rounding", "duplicate", "go-live", "steering"],
    },
    "03_Internal_Daily_Standup.docx": {
        "attendees": ["Christina Latroni", "Eleni Konstantinou", "Petros Markakis"],
        "actions_keywords": ["regression", "scoring rubric", "team mapping"],
        "decisions_keywords": [],
        "dates_keywords": ["EOD"],
        "risks_keywords": [],
        "topics_keywords": ["standup", "scoring", "regression"],
    },
    "04_PPC_Project_Kickoff.docx": {
        "attendees": ["Anastasia Theodoridis", "Kostas Liapis", "Maria Vlachou"],
        "actions_keywords": ["SCADA", "ERD", "charter", "milestone plan", "1:1", "CR-2026-0041"],
        "decisions_keywords": ["both", "thermal", "renewable"],
        "dates_keywords": ["May 28", "May 22", "Thursday"],
        "risks_keywords": ["renewable", "schedule"],
        "topics_keywords": ["scope", "data model", "governance", "risk"],
    },
}

LEADING_FILLER = re.compile(
    r"^(?:yeah|yes|ok|okay|mmm+|hmm+|right|sure|so|um+|uh+|well|"
    r"alright|fair|noted|got it|good|great|perfect|thanks)\b",
    re.IGNORECASE,
)


# ============================================================
# Scoring functions
# ============================================================
def score_structure(mom: dict) -> tuple[float, dict]:
    checks = {}
    mi = mom.get("meeting_info", {})

    checks["title_present"]          = bool(mi.get("title", "").strip())
    checks["date_present"]           = bool(mi.get("date", "").strip())
    checks["participants_present"]   = len(mi.get("participants", [])) >= 2
    checks["exec_summary_present"]   = len(mom.get("executive_summary", "")) >= 80
    checks["topics_present"]         = len(mom.get("discussion_topics", [])) >= 1
    checks["actions_present"]        = len(mom.get("action_items", [])) >= 1

    actions = mom.get("action_items", [])
    if actions:
        with_owner = sum(1 for a in actions if (a.get("owner") or "").strip())
        with_prio = sum(1 for a in actions if (a.get("priority") or "").strip())
        checks["actions_have_owners"] = with_owner / len(actions) >= 0.9
        checks["actions_have_priority"] = with_prio / len(actions) >= 0.9
    else:
        checks["actions_have_owners"] = False
        checks["actions_have_priority"] = False

    risks = mom.get("risks_issues", [])
    if risks:
        with_impact = sum(1 for r in risks if (r.get("impact") or "").strip())
        checks["risks_have_impact"] = with_impact / len(risks) >= 0.9
    else:
        checks["risks_have_impact"] = True  # vacuously true if no risks

    score = 100 * sum(1 for v in checks.values() if v) / len(checks)
    return score, checks


def _all_text(mom: dict) -> str:
    parts = []
    parts.append(mom.get("executive_summary", ""))
    for t in mom.get("discussion_topics", []) or []:
        parts.extend([t.get("title", ""), t.get("summary", "")])
    for a in mom.get("action_items", []) or []:
        parts.extend([a.get("action", ""), a.get("owner", ""), a.get("due_date", "")])
    for d in mom.get("decisions_log", []) or []:
        parts.extend([d.get("decision", ""), d.get("rationale", ""), d.get("owner", "")])
    for r in mom.get("risks_issues", []) or []:
        parts.extend([r.get("description", ""), r.get("owner", "")])
    for t in mom.get("timeline", []) or []:
        parts.extend([t.get("milestone", ""), t.get("date", "")])
    parts.extend(mom.get("open_questions", []) or [])
    mi = mom.get("meeting_info", {})
    parts.append(mi.get("title", ""))
    for p in mi.get("participants", []) or []:
        parts.append(p.get("name", "") if isinstance(p, dict) else str(p))
    return " ||| ".join(parts).lower()


def score_coverage(mom: dict, expected: dict) -> tuple[float, dict]:
    """Coverage = fraction of expected items found anywhere in the MoM."""
    blob = _all_text(mom)

    def hits(needles: list[str]) -> tuple[int, int, list[str]]:
        if not needles:
            return 0, 0, []
        found = [n for n in needles if n.lower() in blob]
        return len(found), len(needles), [n for n in needles if n not in found]

    f_a, t_a, miss_a = hits(expected.get("attendees", []))
    f_act, t_act, miss_act = hits(expected.get("actions_keywords", []))
    f_dec, t_dec, miss_dec = hits(expected.get("decisions_keywords", []))
    f_dat, t_dat, miss_dat = hits(expected.get("dates_keywords", []))
    f_r, t_r, miss_r = hits(expected.get("risks_keywords", []))
    f_t, t_t, miss_t = hits(expected.get("topics_keywords", []))

    total_found = f_a + f_act + f_dec + f_dat + f_r + f_t
    total_expected = t_a + t_act + t_dec + t_dat + t_r + t_t
    score = 100 * total_found / total_expected if total_expected else 100.0

    return score, {
        "attendees":  {"found": f_a, "of": t_a, "miss": miss_a},
        "actions":    {"found": f_act, "of": t_act, "miss": miss_act},
        "decisions":  {"found": f_dec, "of": t_dec, "miss": miss_dec},
        "dates":      {"found": f_dat, "of": t_dat, "miss": miss_dat},
        "risks":      {"found": f_r, "of": t_r, "miss": miss_r},
        "topics":     {"found": f_t, "of": t_t, "miss": miss_t},
    }


def score_hygiene(mom: dict) -> tuple[float, dict]:
    actions = mom.get("action_items", []) or []
    decisions = mom.get("decisions_log", []) or []

    # 1) Action descriptions don't lead with filler
    n_filler = sum(1 for a in actions if LEADING_FILLER.match((a.get("action") or "").strip()))
    pct_clean = 1.0 - (n_filler / len(actions)) if actions else 1.0

    # 2) No near-duplicate actions
    sigs = [(a.get("action") or "")[:60].lower().strip() for a in actions]
    pct_unique = len(set(sigs)) / len(sigs) if sigs else 1.0

    # 3) Action descriptions concise (under 200 chars on average)
    avg_len = sum(len(a.get("action", "")) for a in actions) / len(actions) if actions else 0
    pct_concise = 1.0 if avg_len <= 200 else max(0.0, 1.0 - (avg_len - 200) / 200)

    # 4) Decisions don't lead with filler
    n_dec_filler = sum(1 for d in decisions if LEADING_FILLER.match((d.get("decision") or "").strip()))
    pct_dec_clean = 1.0 - (n_dec_filler / len(decisions)) if decisions else 1.0

    # Equal-weight average
    score = 100 * (pct_clean + pct_unique + pct_concise + pct_dec_clean) / 4
    return score, {
        "action_filler_lead_pct": round(100 * (1 - pct_clean), 1),
        "action_duplicate_pct":   round(100 * (1 - pct_unique), 1),
        "action_avg_chars":       round(avg_len, 1),
        "decision_filler_pct":    round(100 * (1 - pct_dec_clean), 1),
    }


# ============================================================
# LLM-as-judge
# ============================================================
JUDGE_SYSTEM = """You are a senior consulting Engagement Manager evaluating a junior's Meeting Minutes draft.

You will receive:
  1. A short excerpt of the original meeting transcript (truncated for cost).
  2. The team's MoM Rules — the standard the draft should meet.
  3. The candidate MoM as JSON.

Grade the candidate MoM on 4 dimensions, 1-10 each (10 = exemplary):

  TONE       — Executive consulting prose? Concise, professional, ready to send to a senior client?
  COMPLETENESS — Did the MoM capture all material decisions, actions, and risks from the transcript?
  ACCURACY   — Are owners/dates/decisions correctly attributed? No invented facts? No misquotes?
  STRUCTURE  — Does it follow the Rules (sections, ordering, action-item format with owner+priority+due)?

Also write a 2-3 sentence critique pointing out the single biggest improvement opportunity.

Submit via the `submit_grade` tool."""


JUDGE_SCHEMA = {
    "type": "object",
    "required": ["tone", "completeness", "accuracy", "structure", "critique"],
    "properties": {
        "tone":         {"type": "integer", "minimum": 1, "maximum": 10},
        "completeness": {"type": "integer", "minimum": 1, "maximum": 10},
        "accuracy":     {"type": "integer", "minimum": 1, "maximum": 10},
        "structure":    {"type": "integer", "minimum": 1, "maximum": 10},
        "critique":     {"type": "string"},
    },
}


def judge_with_llm(transcript_text: str, rules: str, mom: dict) -> dict:
    """Call Claude to grade the MoM. Returns the parsed dict from tool_use."""
    import anthropic
    client = anthropic.Anthropic()
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    # Truncate transcript to keep token cost reasonable (judges work fine on excerpts)
    truncated = transcript_text[:8000] + ("\n[...truncated...]" if len(transcript_text) > 8000 else "")
    mom_str = json.dumps(mom, ensure_ascii=False, indent=2)[:8000]

    user_msg = (
        f"=== TRANSCRIPT EXCERPT ===\n{truncated}\n\n"
        f"=== TEAM MOM RULES ===\n{rules}\n\n"
        f"=== CANDIDATE MOM (JSON) ===\n{mom_str}\n\n"
        f"Grade this draft via the submit_grade tool."
    )

    resp = client.messages.create(
        model=model,
        max_tokens=1500,
        temperature=0.0,
        system=JUDGE_SYSTEM,
        tools=[{"name": "submit_grade", "description": "Submit the rubric grade for this MoM.", "input_schema": JUDGE_SCHEMA}],
        tool_choice={"type": "tool", "name": "submit_grade"},
        messages=[{"role": "user", "content": user_msg}],
    )
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use":
            data = dict(block.input)
            avg = (data["tone"] + data["completeness"] + data["accuracy"] + data["structure"]) / 4
            data["score"] = round(avg * 10, 1)  # 0-100 scale
            return data
    raise RuntimeError("LLM judge did not return the expected tool_use block")


def transcript_text_from(path: Path) -> str:
    """Quick re-read of transcript text for the judge — independent of the cleaner."""
    from run import load_transcript, clean_transcript, transcript_to_text
    raw, suffix = load_transcript(path)
    cleaned = clean_transcript(raw, suffix)
    return transcript_to_text(cleaned)


def quick_quality_check_with_llm(mom: dict, transcript_text: str = "", rules_text: str = "") -> dict:
    """Same as quick_quality_check, but if ANTHROPIC_API_KEY is set also calls Claude
    as judge and returns a 'llm' sub-dict with 4 rubric scores + critique.
    """
    base = quick_quality_check(mom)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return base
    try:
        judge = judge_with_llm(transcript_text, rules_text, mom)
        base["llm"] = judge
        # Combined score: 70% deterministic + 30% LLM judge
        base["combined_total"] = round(0.7 * base["total"] + 0.3 * judge["score"], 1)
        base["combined_grade"] = grade(base["combined_total"])
    except Exception as e:
        base["llm_error"] = str(e)
    return base


def quick_quality_check(mom: dict) -> dict:
    """Lightweight quality check — usable directly from the UI without ground truth.

    Runs Structure + Hygiene against the generated MoM and returns a single
    score dict with checks, score, and grade. Coverage is skipped (it requires
    per-sample expected items) — instead we add a small set of "send-ready"
    checks that flag content unsuitable for a client deliverable.
    """
    s_struct, struct_detail = score_structure(mom)
    s_hyg, hyg_detail = score_hygiene(mom)

    # Send-ready checks
    actions = mom.get("action_items") or []
    decisions = mom.get("decisions_log") or []
    sr = {
        "all_actions_have_owner":   all((a.get("owner") or "").strip() for a in actions) if actions else True,
        "all_actions_have_priority": all((a.get("priority") or "").strip() for a in actions) if actions else True,
        "all_actions_have_due":     all((a.get("due_date") or "").strip() for a in actions) if actions else True,
        "no_questions_in_actions":  not any((a.get("action") or "").rstrip().endswith(("?", ";")) for a in actions),
        "no_filler_in_decisions":   not any(LEADING_FILLER.match((d.get("decision") or "").strip()) for d in decisions),
        "executive_summary_substantive": len(mom.get("executive_summary") or "") >= 120,
    }
    sr_score = 100 * sum(1 for v in sr.values() if v) / len(sr) if sr else 0

    # Equal weight: structure 40 / hygiene 30 / send-ready 30
    total = round(0.4 * s_struct + 0.3 * s_hyg + 0.3 * sr_score, 1)
    return {
        "structure": round(s_struct, 1),
        "hygiene": round(s_hyg, 1),
        "send_ready": round(sr_score, 1),
        "total": total,
        "grade": grade(total),
        "structure_detail": struct_detail,
        "hygiene_detail": hyg_detail,
        "send_ready_detail": sr,
    }


def grade(score: float) -> str:
    if score >= 90: return "A"
    if score >= 80: return "B"
    if score >= 70: return "C"
    if score >= 60: return "D"
    return "F"


# ============================================================
# Main
# ============================================================
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--provider", choices=["auto", "anthropic", "rule_based"], default="auto")
    p.add_argument("--llm", action="store_true", help="Also use Claude as a judge (requires ANTHROPIC_API_KEY)")
    p.add_argument("--no-html", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    samples = sorted([p for p in SAMPLES_DIR.iterdir() if p.is_file()])
    if not samples:
        print(f"No samples in {SAMPLES_DIR}")
        return 1

    use_llm_judge = args.llm and bool(os.environ.get("ANTHROPIC_API_KEY"))
    if args.llm and not use_llm_judge:
        print("  ⚠ --llm requested but ANTHROPIC_API_KEY not set; skipping LLM judge.\n")

    print("=" * 100)
    judge_label = "+ Claude judge" if use_llm_judge else "deterministic only"
    print(f"  AI Meeting Minutes Generator — Quality Scorecard  ({args.provider}, {judge_label})")
    print("=" * 100)

    from run import RULES_DOC
    rules_text = _load_rules_from(RULES_DOC) if RULES_DOC.exists() else ""

    rows = []
    for s in samples:
        try:
            out_path, mom = process_one(s, provider=args.provider, output_dir=OUTPUT)
        except Exception as e:
            rows.append({"sample": s.name, "error": str(e)})
            continue

        s_struct, struct_detail = score_structure(mom)
        s_cov, cov_detail = score_coverage(mom, EXPECTED.get(s.name, {}))
        s_hyg, hyg_detail = score_hygiene(mom)

        total = round(0.4 * s_struct + 0.4 * s_cov + 0.2 * s_hyg, 1)
        row = {
            "sample": s.name,
            "structure": round(s_struct, 1),
            "coverage": round(s_cov, 1),
            "hygiene": round(s_hyg, 1),
            "total": total,
            "grade": grade(total),
            "out": out_path.name,
            "structure_detail": struct_detail,
            "coverage_detail": cov_detail,
            "hygiene_detail": hyg_detail,
            "counts": {
                "actions": len(mom.get("action_items", [])),
                "decisions": len(mom.get("decisions_log", [])),
                "risks": len(mom.get("risks_issues", [])),
                "topics": len(mom.get("discussion_topics", [])),
                "attendees": len(mom.get("meeting_info", {}).get("participants", [])),
            },
        }

        if use_llm_judge:
            try:
                tx = transcript_text_from(s)
                judge = judge_with_llm(tx, rules_text, mom)
                row["llm"] = judge
                row["llm_score"] = judge["score"]
                row["llm_grade"] = grade(judge["score"])
            except Exception as e:
                row["llm_error"] = str(e)

        rows.append(row)

    # ----- Console table -----
    if use_llm_judge:
        header = f"  {'Sample':<48} {'Struct':>7} {'Cov':>7} {'Hyg':>7} {'Det':>7} {'LLM':>7} {'':>3}"
        print(header)
        print("  " + "-" * (len(header) - 2))
        for r in rows:
            if "error" in r:
                print(f"  {r['sample']:<48} ERROR: {r['error']}"); continue
            llm_cell = f"{r.get('llm_score', '—'):>6}%" if r.get("llm_score") is not None else "    —  "
            print(f"  {r['sample']:<48} {r['structure']:>6}% {r['coverage']:>6}% {r['hygiene']:>6}% {r['total']:>6}% {llm_cell}  {r['grade']:>2}")
        print("  " + "-" * (len(header) - 2))
        det_avg = round(sum(r["total"] for r in rows if "total" in r) / max(1, len([r for r in rows if "total" in r])), 1)
        llm_scores = [r.get("llm_score") for r in rows if r.get("llm_score") is not None]
        llm_avg = round(sum(llm_scores) / len(llm_scores), 1) if llm_scores else None
        llm_cell = f"{llm_avg:>6}%" if llm_avg is not None else "    —  "
        print(f"  {'OVERALL':<48} {'':>7} {'':>7} {'':>7} {det_avg:>6}% {llm_cell}  {grade(det_avg)}")
    else:
        print(f"  {'Sample':<48} {'Struct':>7} {'Cov':>7} {'Hyg':>7} {'Total':>7} {'':>3}")
        print("  " + "-" * 92)
        for r in rows:
            if "error" in r:
                print(f"  {r['sample']:<48} ERROR: {r['error']}"); continue
            print(f"  {r['sample']:<48} {r['structure']:>6}% {r['coverage']:>6}% {r['hygiene']:>6}% {r['total']:>6}%  {r['grade']:>2}")
        print("  " + "-" * 92)
        avg = round(sum(r["total"] for r in rows if "total" in r) / max(1, len(rows)), 1)
        print(f"  {'OVERALL':<48} {'':>7} {'':>7} {'':>7} {avg:>6}%  {grade(avg)}")
    print()

    # ----- Write JSON + HTML -----
    OUTPUT.mkdir(parents=True, exist_ok=True)
    json_path = OUTPUT / "quality_scorecard.json"
    json_path.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  JSON: {json_path.relative_to(ROOT)}")

    if not args.no_html:
        html_path = OUTPUT / "quality_scorecard.html"
        html_path.write_text(_render_html(rows, args.provider, use_llm_judge), encoding="utf-8")
        print(f"  HTML: {html_path.relative_to(ROOT)}")

    return 0


# ============================================================
# HTML scorecard
# ============================================================
def _render_html(rows: list[dict], provider: str, with_llm: bool = False) -> str:
    overall = round(sum(r["total"] for r in rows if "total" in r) / max(1, len([r for r in rows if "total" in r])), 1) if rows else 0
    overall_grade = grade(overall) if rows else "—"
    llm_scores = [r.get("llm_score") for r in rows if r.get("llm_score") is not None]
    llm_overall = round(sum(llm_scores) / len(llm_scores), 1) if llm_scores else None
    when = datetime.now().strftime("%Y-%m-%d %H:%M")

    sample_cards = ""
    for r in rows:
        if "error" in r:
            sample_cards += f'<div class="card"><h3>{r["sample"]}</h3><div class="err">ERROR: {r["error"]}</div></div>'
            continue
        cd = r["coverage_detail"]
        miss_html = ""
        for cat, d in cd.items():
            if d.get("miss"):
                miss_html += f'<div class="miss"><strong>{cat}:</strong> missing {", ".join(d["miss"])}</div>'
        sd = r["structure_detail"]
        struct_rows = "".join(
            f'<tr><td>{k.replace("_", " ").title()}</td><td>{"✓" if v else "✗"}</td></tr>' for k, v in sd.items()
        )

        llm_panel = ""
        if r.get("llm"):
            j = r["llm"]
            llm_panel = f"""
          <div class="llm-card">
            <div class="llm-head">
              <strong>Claude Judge</strong>
              <span class="grade-pill grade-{r["llm_grade"].lower()}">{r["llm_grade"]} · {r["llm_score"]}%</span>
            </div>
            <div class="kpis">
              <div class="kpi"><div class="num">{j['tone']}/10</div><div class="lbl">Tone</div></div>
              <div class="kpi"><div class="num">{j['completeness']}/10</div><div class="lbl">Completeness</div></div>
              <div class="kpi"><div class="num">{j['accuracy']}/10</div><div class="lbl">Accuracy</div></div>
              <div class="kpi"><div class="num">{j['structure']}/10</div><div class="lbl">Structure</div></div>
            </div>
            <div class="critique"><strong>Critique:</strong> {j.get('critique', '')}</div>
          </div>"""
        elif r.get("llm_error"):
            llm_panel = f'<div class="llm-card err">LLM judge failed: {r["llm_error"]}</div>'

        sample_cards += f"""
        <div class="card">
          <div class="sample-head">
            <h3>{r["sample"]}</h3>
            <div class="grade-pill grade-{r["grade"].lower()}">{r["grade"]} · {r["total"]}%</div>
          </div>
          <div class="kpis">
            <div class="kpi"><div class="num">{r["structure"]}%</div><div class="lbl">Structure</div></div>
            <div class="kpi"><div class="num">{r["coverage"]}%</div><div class="lbl">Coverage</div></div>
            <div class="kpi"><div class="num">{r["hygiene"]}%</div><div class="lbl">Hygiene</div></div>
            <div class="kpi"><div class="num">{r["counts"]["actions"]}</div><div class="lbl">Actions</div></div>
            <div class="kpi"><div class="num">{r["counts"]["decisions"]}</div><div class="lbl">Decisions</div></div>
            <div class="kpi"><div class="num">{r["counts"]["risks"]}</div><div class="lbl">Risks</div></div>
          </div>
          {llm_panel}
          <details>
            <summary>Structural checks</summary>
            <table>{struct_rows}</table>
          </details>
          <details>
            <summary>Coverage detail</summary>
            {miss_html or '<div class="ok">All expected items captured.</div>'}
          </details>
          <details>
            <summary>Hygiene detail</summary>
            <pre>{json.dumps(r["hygiene_detail"], indent=2)}</pre>
          </details>
          <div class="output-link">→ <code>{r["out"]}</code></div>
        </div>
        """

    llm_overall_html = ""
    if llm_overall is not None:
        llm_overall_html = f"""
    <div class="overall grade-{grade(llm_overall).lower()}" style="margin-top:14px;">
      <div class="left">
        <h2 style="font-size:24px;">Claude judge — overall</h2>
        <div class="sub">Average across all samples (1-10 rubric × 10 → 0-100)</div>
      </div>
      <div class="right grade-{grade(llm_overall).lower()}">
        <div class="num">{llm_overall}%</div>
        <div class="grade">Grade {grade(llm_overall)}</div>
      </div>
    </div>"""

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>MoM Quality Scorecard</title>
<style>
  :root{{--green:#86BC25;--dark:#000;--gray:#53565A;--light:#F5F5F5;--blue:#0076A8;--red:#D32F2F;--amber:#F9A825}}
  *{{margin:0;padding:0;box-sizing:border-box}}
  body{{font-family:'Segoe UI',Tahoma,sans-serif;background:var(--light);color:var(--gray);line-height:1.6;font-size:14px}}
  .hero{{background:linear-gradient(135deg,#000,#1a1a2e 60%,#0076A8);color:#fff;padding:35px 50px}}
  .hero h1{{font-size:26px;font-weight:300}}.hero h2{{font-size:16px;color:var(--green);margin-top:6px}}
  .hero .sub{{font-size:12px;color:rgba(255,255,255,.55);margin-top:6px}}
  .c{{max-width:1200px;margin:0 auto;padding:25px 40px}}
  h3{{color:var(--dark);font-size:18px;margin-bottom:14px;padding-bottom:6px;border-bottom:3px solid var(--green)}}
  .overall{{background:#fff;border-radius:8px;padding:24px 30px;box-shadow:0 2px 6px rgba(0,0,0,.06);margin-bottom:24px;display:flex;align-items:center;justify-content:space-between}}
  .overall .left h2{{color:var(--dark);font-size:32px}}
  .overall .left .sub{{color:var(--gray);font-size:13px;margin-top:4px}}
  .overall .right .num{{font-size:64px;font-weight:700;line-height:1}}
  .overall .right .grade{{font-size:18px;color:var(--gray);text-align:right}}
  .grade-a .num,.grade-pill.grade-a{{color:#2e7d32}}
  .grade-b .num,.grade-pill.grade-b{{color:#558b2f}}
  .grade-c .num,.grade-pill.grade-c{{color:#e65100}}
  .grade-d .num,.grade-pill.grade-d{{color:#bf360c}}
  .grade-f .num,.grade-pill.grade-f{{color:#c62828}}
  .card{{background:#fff;border-radius:8px;padding:20px 24px;margin-bottom:16px;box-shadow:0 2px 6px rgba(0,0,0,.06)}}
  .sample-head{{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}}
  .sample-head h3{{border-bottom:none;padding-bottom:0;margin-bottom:0}}
  .grade-pill{{padding:4px 14px;border-radius:14px;font-weight:700;background:#f5f5f5;font-size:13px}}
  .kpis{{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}}
  .kpi{{flex:1;min-width:90px;background:#fafafa;border-radius:6px;padding:12px 14px;text-align:center}}
  .kpi .num{{font-size:22px;font-weight:700;color:var(--dark)}}
  .kpi .lbl{{font-size:10px;color:var(--gray);text-transform:uppercase;letter-spacing:.4px}}
  details{{margin-top:8px;padding:6px 0;border-top:1px solid #f0f0f0}}
  summary{{cursor:pointer;font-weight:600;color:var(--dark);font-size:13px;padding:6px 0}}
  details table{{width:100%;font-size:12px;margin-top:6px}}
  details td{{padding:4px 0;border-bottom:1px solid #f0f0f0}}
  .miss{{color:#c62828;font-size:12px;padding:3px 0}}
  .ok{{color:#2e7d32;font-size:13px}}
  .output-link{{font-size:11px;color:var(--gray);margin-top:10px}}
  pre{{background:#f5f5f5;padding:10px;border-radius:4px;font-size:11px;overflow-x:auto}}
  .footer{{text-align:center;padding:18px;color:#999;font-size:11px;border-top:1px solid #ddd;margin-top:24px}}
  .llm-card{{background:#f5f9fa;border-left:4px solid var(--blue);border-radius:6px;padding:14px 18px;margin:14px 0}}
  .llm-card.err{{background:#ffebee;border-left-color:#c62828;color:#c62828;font-size:12px}}
  .llm-head{{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}}
  .critique{{font-size:13px;color:var(--gray);margin-top:10px;font-style:italic;line-height:1.5}}
</style>
</head><body>
<div class="hero">
  <h1>MoM Quality Scorecard</h1>
  <h2>Provider: {provider} &middot; Generated {when}</h2>
  <div class="sub">{len(rows)} sample(s) evaluated &middot; Structure 40% &middot; Coverage 40% &middot; Hygiene 20%</div>
</div>
<div class="c">
  <div class="overall grade-{overall_grade.lower()}">
    <div class="left">
      <h2>Overall quality</h2>
      <div class="sub">Average across all samples · provider={provider} · deterministic score (Structure/Coverage/Hygiene)</div>
    </div>
    <div class="right grade-{overall_grade.lower()}">
      <div class="num">{overall}%</div>
      <div class="grade">Grade {overall_grade}</div>
    </div>
  </div>
  {llm_overall_html}
  <h3>Per-sample breakdown</h3>
  {sample_cards}
</div>
<div class="footer">AI Meeting Minutes Generator · Quality Scorecard · Strictly Private &amp; Confidential</div>
</body></html>"""


if __name__ == "__main__":
    import sys
    sys.exit(main())
