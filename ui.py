"""Streamlit UI for the AI Meeting Minutes Generator.

Run:
    streamlit run ui.py

Drop a Teams transcript (or pick a sample) → get a professional MoM Word doc.
Defaults only. No knobs to turn.
"""
from __future__ import annotations

import difflib
import os
import re
import tempfile
import time
from datetime import datetime
from html import escape
from pathlib import Path

import streamlit as st

from run import (
    INPUT,
    OUTPUT,
    RULES_DOC,
    TEMPLATE_DOC,
    _load_rules_from,
    clean_transcript,
    load_transcript,
    process_one,
    save_rules_text,
)
from _score import quick_quality_check, quick_quality_check_with_llm
from _feedback import (
    apply_rule_amendment,
    feedback_stats,
    log_feedback,
    propose_rule_amendment,
    recent_feedback,
)
from _mailer import open_outlook_draft

SAMPLES_DIR = INPUT / "transcript"

SAMPLE_LABELS = {
    "01_Enerwave_ETL_Status_Sync.docx":        ("Enerwave — ETL Pipeline Status Sync",
                                                "Data Engineering project. Four attendees · ~6 min. Source ingestion progress, transformation rules, data quality, go-live timeline."),
    "02_Enerwave_Fabric_Backend_Review.docx":  ("Enerwave — Fabric Reporting Backend Review",
                                                "Microsoft Fabric backend design. Four attendees · ~7 min. Capacity sizing, OneLake medallion, semantic model, governance."),
    "03_LIDL_UAT_Exception_Review.docx":       ("LIDL — UAT Status & Exception Review (Greek / English mixed)",
                                                "Project management + UAT exception update. Five attendees · ~7 min. Defect severity breakdown, three open exceptions, go/no-go gate. Bilingual call."),
}

# ============================================================
# Page config
# ============================================================
st.set_page_config(
    page_title="Meeting Minutes Generator",
    page_icon="📝",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ============================================================
# Deloitte-styled CSS
# ============================================================
st.markdown(
    """
    <style>
      :root { --green:#86BC25; --dark:#000; --gray:#53565A; --light:#F5F5F5; --blue:#0076A8; --red:#D32F2F; --amber:#F9A825; }
      header[data-testid="stHeader"] { background: transparent; }
      .block-container {
        padding-top: 0 !important; padding-left: 0 !important; padding-right: 0 !important;
        max-width: 1200px; margin: 0 auto;
      }
      #MainMenu, footer { visibility: hidden; }
      section[data-testid="stSidebar"] { display: none; }
      .hero {
        background: linear-gradient(135deg, #000 0%, #1a1a2e 60%, #0076A8 100%);
        color: #fff; padding: 36px 50px 28px 50px;
        margin: 0 -1rem 28px -1rem; border-radius: 0 0 8px 8px;
      }
      .hero h1 { font-size: 28px; font-weight: 300; margin: 0; color: #fff; }
      .hero h2 { font-size: 15px; color: var(--green); font-weight: 600; margin: 4px 0 0 0; letter-spacing: .5px; }
      .hero .sub { font-size: 12px; color: rgba(255,255,255,.55); margin-top: 8px; }
      .inner { padding: 0 50px 30px 50px; }
      h3 { color: var(--dark); font-size: 18px; padding-bottom: 6px; border-bottom: 3px solid var(--green); margin: 28px 0 14px 0; }
      .card { background: #fff; border-radius: 8px; padding: 18px 22px; box-shadow: 0 2px 6px rgba(0,0,0,.06); margin-bottom: 14px; }
      .summary-card { background: #fff; padding: 20px 24px; border-radius: 8px; border-left: 4px solid var(--blue); box-shadow: 0 2px 6px rgba(0,0,0,.06); margin-bottom: 16px; }
      .topic-card { padding: 14px 18px; border-left: 4px solid var(--green); background: #fafbf6; border-radius: 6px; margin-bottom: 10px; }
      div[data-testid="stMetric"] { background: #fff; padding: 16px 18px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,.06); }
      div[data-testid="stMetricValue"] { font-size: 30px; font-weight: 700; color: var(--dark); }
      div[data-testid="stMetricLabel"] { color: var(--gray); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
      .stDownloadButton button { background: var(--green) !important; color: #fff !important; border: none !important; font-weight: 600 !important; padding: 0.7rem 1.4rem !important; border-radius: 6px !important; font-size: 14px !important; }
      .stDownloadButton button:hover { background: #6e9c1e !important; }
      .stButton button { background: #fff !important; border: 1px solid #ddd !important; color: var(--dark) !important; font-weight: 500 !important; padding: 0.5rem 1rem !important; border-radius: 6px !important; }
      .stButton button:hover { border-color: var(--green) !important; color: var(--green) !important; }
      div[data-baseweb="tab-list"] { background: transparent; border-bottom: 1px solid #eee; }
      button[data-baseweb="tab"] { font-weight: 600; color: var(--gray); }
      button[data-baseweb="tab"][aria-selected="true"] { color: var(--green) !important; border-bottom: 3px solid var(--green) !important; }
      .bg { display: inline-block; padding: 2px 9px; border-radius: 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; }
      .b-red { background:#ffebee; color:#c62828; } .b-amber { background:#fff8e1; color:#e65100; } .b-green { background:#e8f5e9; color:#2e7d32; } .b-blue { background:#e3f2fd; color:#0d47a1; } .b-gray { background:#f5f5f5; color:#424242; }
      .pill { display: inline-block; padding: 4px 12px; border-radius: 14px; font-size: 12px; font-weight: 600; }
      .pill-ok { background: #e8f5e9; color: #2e7d32; }
      .pill-warn { background: #fff8e1; color: #e65100; }
      .pill-err { background: #ffebee; color: #c62828; }
      .sample { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 14px 16px; height: 100%; }
      .sample h5 { color: var(--dark); margin: 0 0 4px 0; font-size: 13px; font-weight: 700; }
      .sample p { color: var(--gray); margin: 0; font-size: 12px; line-height: 1.5; }
      .sample .fmt { display: inline-block; padding: 1px 7px; border-radius: 8px; font-size: 10px; font-weight: 700; background: #f0f0f0; color: var(--gray); margin-bottom: 6px; }
      div[data-testid="stFileUploader"] section { border: 2px dashed var(--green) !important; border-radius: 8px !important; background: rgba(134, 188, 37, 0.04) !important; padding: 28px !important; }
      .footer { text-align: center; padding: 18px 0 8px 0; color: #999; font-size: 11px; border-top: 1px solid #eee; margin: 36px 50px 0 50px; }
      hr { margin: 16px 0 !important; }
    </style>
    """,
    unsafe_allow_html=True,
)

# ============================================================
# Hero
# ============================================================
api_key_set = bool(os.environ.get("ANTHROPIC_API_KEY"))
mode_caption = "Claude AI" if api_key_set else "Rule-based fallback"

st.markdown(
    f"""
    <div class="hero">
      <h1>Meeting Minutes Generator</h1>
      <h2>An AI accelerator for converting Microsoft Teams transcripts into client-ready minutes</h2>
      <div class="sub">{mode_caption} &nbsp;·&nbsp; Deloitte AI Prompting Lab</div>
    </div>
    """,
    unsafe_allow_html=True,
)

st.markdown('<div class="inner">', unsafe_allow_html=True)


# ============================================================
# Helpers
# ============================================================
def _badge(text: str, kind: str = "priority") -> str:
    v = (text or "").lower()
    if kind == "type":
        if v == "issue":
            return f'<span class="bg b-red">{text}</span>'
        return f'<span class="bg b-amber">{text}</span>'
    if v == "high":
        return f'<span class="bg b-red">{text}</span>'
    if v == "medium":
        return f'<span class="bg b-amber">{text}</span>'
    if v == "low":
        return f'<span class="bg b-green">{text}</span>'
    return f'<span class="bg b-gray">{text or "—"}</span>'


def list_samples() -> list[Path]:
    if not SAMPLES_DIR.exists():
        return []
    return sorted(SAMPLES_DIR.iterdir(), key=lambda p: p.name)


def _fmt_attendee(p) -> str:
    if isinstance(p, str):
        return p
    name = p.get("name", "")
    role = p.get("role", "")
    org = p.get("organization", "")
    if role and org:
        return f"{name} ({role}, {org})"
    if role:
        return f"{name} ({role})"
    if org:
        return f"{name} ({org})"
    return name


def datetime_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _diff_inline(raw: str, cleaned: str) -> tuple[str, bool]:
    """Render an inline word-level diff of raw → cleaned.

    Returns (html, changed). The HTML shows the raw text with red strike-through
    on removed words and green underline on inserted words. `changed` is True
    if the cleaned text differs from raw.
    """
    if raw.strip() == cleaned.strip():
        return f'<span style="color:#1a1a1a;">{escape(cleaned)}</span>', False
    a = raw.split()
    b = cleaned.split()
    matcher = difflib.SequenceMatcher(None, a, b)
    parts: list[str] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            parts.append(escape(" ".join(a[i1:i2])))
        elif tag == "delete":
            parts.append(
                f'<span style="text-decoration:line-through;color:#c62828;background:#ffebee;'
                f'padding:0 3px;border-radius:3px;">{escape(" ".join(a[i1:i2]))}</span>'
            )
        elif tag == "insert":
            parts.append(
                f'<span style="color:#2e7d32;background:#e8f5e9;'
                f'padding:0 3px;border-radius:3px;">{escape(" ".join(b[j1:j2]))}</span>'
            )
        elif tag == "replace":
            parts.append(
                f'<span style="text-decoration:line-through;color:#c62828;background:#ffebee;'
                f'padding:0 3px;border-radius:3px;">{escape(" ".join(a[i1:i2]))}</span> '
                f'<span style="color:#2e7d32;background:#e8f5e9;'
                f'padding:0 3px;border-radius:3px;">{escape(" ".join(b[j1:j2]))}</span>'
            )
        parts.append(" ")
    return "".join(parts).strip(), True


# ============================================================
# Status strip
# ============================================================
sc1, sc2, sc3 = st.columns(3)
with sc1:
    if api_key_set:
        st.markdown(f'<span class="pill pill-ok">✓ Claude API connected</span>', unsafe_allow_html=True)
    else:
        st.markdown(f'<span class="pill pill-warn">⚠ Rule-based mode (no API key)</span>', unsafe_allow_html=True)
with sc2:
    if RULES_DOC.exists():
        st.markdown(f'<span class="pill pill-ok">✓ Rules.docx loaded</span>', unsafe_allow_html=True)
    else:
        st.markdown(f'<span class="pill pill-err">✗ Rules.docx missing</span>', unsafe_allow_html=True)
with sc3:
    if TEMPLATE_DOC.exists():
        st.markdown(f'<span class="pill pill-ok">✓ Template.docx loaded</span>', unsafe_allow_html=True)
    else:
        st.markdown(f'<span class="pill pill-err">✗ Template.docx missing</span>', unsafe_allow_html=True)


# ============================================================
# Rules — view / edit
# ============================================================
rules_text = _load_rules_from(RULES_DOC) if RULES_DOC.exists() else ""

with st.expander("📜  View / edit MoM rules  (the AI reads these on every run)"):
    st.caption(
        "These rules drive the AI. Step 1 governs how the transcript is cleaned up "
        "before extraction. Step 2 governs how the MoM is written. Edit and save to "
        "change behaviour for the next run."
    )
    edited = st.text_area(
        " ",
        value=rules_text,
        height=380,
        label_visibility="collapsed",
        key="rules_editor",
    )
    rb1, rb2, rb3 = st.columns([1, 1, 4])
    with rb1:
        if st.button("💾 Save changes", use_container_width=True, type="primary"):
            try:
                save_rules_text(edited, RULES_DOC)
                st.success("Saved. The AI will use these rules on the next generation.")
            except Exception as e:
                st.error(f"Save failed: {e}")
    with rb2:
        if st.button("↺ Reset to defaults", use_container_width=True):
            import subprocess, sys as _sys
            try:
                subprocess.run([_sys.executable, "_build_inputs.py"], cwd=str(INPUT.parent), check=True, capture_output=True)
                st.success("Restored defaults. Reload the page to see them.")
            except Exception as e:
                st.error(f"Reset failed: {e}")
    with rb3:
        if RULES_DOC.exists():
            with open(RULES_DOC, "rb") as f:
                rules_bytes = f.read()
            st.download_button(
                "📥 Download Rules.docx",
                data=rules_bytes,
                file_name="Rules.docx",
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                use_container_width=True,
                key="dl_rules",
            )


# Past minutes archive
with st.expander("Past minutes  ·  recent outputs in /output"):
    if not OUTPUT.exists():
        st.caption("No past runs yet — the folder will be created on first generation.")
    else:
        past = sorted(
            (p for p in OUTPUT.iterdir() if p.is_file() and p.suffix.lower() == ".docx"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )[:15]
        if not past:
            st.caption("No past minutes documents in /output yet.")
        else:
            st.caption(f"Most recent {len(past)} document(s). View the transcript that produced it, or re-download the Word doc.")
            for p in past:
                ts = datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
                size_kb = p.stat().st_size // 1024
                sidecar = p.with_name(p.stem + "_transcript.json")
                has_transcript = sidecar.exists()

                row_a, row_b, row_c = st.columns([5, 1, 1])
                row_a.markdown(
                    f'<div style="padding:6px 0;font-size:13px;">'
                    f'<strong>{p.stem}</strong>'
                    f'<div style="color:#999;font-size:11px;margin-top:2px;">{ts}  ·  {size_kb} KB'
                    f'{"  ·  transcript available" if has_transcript else "  ·  no transcript"}</div>'
                    f'</div>',
                    unsafe_allow_html=True,
                )
                with row_b:
                    if has_transcript:
                        if st.button("View transcript", key=f"view_past_{p.name}", use_container_width=True):
                            st.session_state["viewing_past_transcript"] = str(sidecar)
                    else:
                        st.button("View transcript", key=f"view_past_{p.name}", use_container_width=True, disabled=True)
                with row_c:
                    with open(p, "rb") as f:
                        st.download_button(
                            "Download",
                            data=f.read(),
                            file_name=p.name,
                            mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            use_container_width=True,
                            key=f"dl_past_{p.name}",
                        )

# Render selected past transcript (below the expander)
if st.session_state.get("viewing_past_transcript"):
    sc_path = Path(st.session_state["viewing_past_transcript"])
    if sc_path.exists():
        try:
            import json as _json
            payload = _json.loads(sc_path.read_text(encoding="utf-8"))
        except Exception as e:
            st.error(f"Could not read transcript JSON: {e}")
            payload = None

        if payload:
            utts = payload.get("utterances", [])
            n_changed = sum(
                1 for u in utts if (u.get("raw_text") or "").strip() != (u.get("text") or "").strip()
            )
            head_l, head_r = st.columns([5, 1])
            head_l.markdown(
                f"<h4 style='margin:18px 0 4px 0;color:#000;font-size:15px;'>Transcript &middot; "
                f"<span style='color:#53565A;font-weight:400;'>{escape(payload.get('meeting_title','') or sc_path.stem)}</span></h4>"
                f"<div style='color:#53565A;font-size:11px;margin-bottom:8px;'>"
                f"{len(utts)} turns &middot; {len(payload.get('speakers', []))} speakers &middot; "
                f"{n_changed} edited &middot; language {escape(payload.get('language','') or 'Unknown')}</div>",
                unsafe_allow_html=True,
            )
            with head_r:
                if st.button("Close", use_container_width=True, key="close_past_transcript"):
                    st.session_state.pop("viewing_past_transcript", None)
                    st.rerun()

            show_corr = st.toggle(
                "Show AI corrections",
                value=st.session_state.get("show_past_corrections", False),
                key="show_past_corrections_toggle",
                help="Reveal the original text alongside the AI-corrected version, side-by-side.",
            )
            st.session_state["show_past_corrections"] = show_corr

            if show_corr:
                # Side-by-side
                head_l2, head_r2 = st.columns(2)
                head_l2.markdown('<div class="sxs-col-head original">Original transcript</div>', unsafe_allow_html=True)
                head_r2.markdown('<div class="sxs-col-head cleaned">AI-corrected (used by the model)</div>', unsafe_allow_html=True)
                for u in utts:
                    speaker = escape(u.get("speaker", ""))
                    ts2 = u.get("ts", "") or ""
                    cleaned_text = u.get("text", "") or ""
                    raw_text = u.get("raw_text", "") or cleaned_text
                    diff_html, changed = _diff_inline(raw_text, cleaned_text)
                    edited_cls = " sxs-turn-edited" if changed else ""
                    left = (
                        f'<div class="sxs-turn-l{edited_cls}">'
                        f'<div class="sxs-meta"><b>{speaker}</b> &middot; {ts2}</div>'
                        f'<div class="sxs-text gray">{diff_html}</div>'
                        f'</div>'
                    )
                    right = (
                        f'<div class="sxs-turn-r{edited_cls}">'
                        f'<div class="sxs-meta"><b>{speaker}</b> &middot; {ts2}</div>'
                        f'<div class="sxs-text">{escape(cleaned_text)}</div>'
                        f'</div>'
                    )
                    cl, cr = st.columns(2)
                    cl.markdown(left, unsafe_allow_html=True)
                    cr.markdown(right, unsafe_allow_html=True)
            else:
                for u in utts:
                    speaker = escape(u.get("speaker", ""))
                    ts2 = u.get("ts", "") or ""
                    cleaned_text = u.get("text", "") or ""
                    st.markdown(
                        f'<div class="turn"><span class="speaker">{speaker}</span>'
                        f'<span class="ts">{ts2}</span>'
                        f'<div class="text">{escape(cleaned_text)}</div></div>',
                        unsafe_allow_html=True,
                    )
    else:
        st.warning("Transcript file no longer exists.")
        st.session_state.pop("viewing_past_transcript", None)


# ============================================================
# Choose transcript
# ============================================================
st.markdown("<h3>Choose your transcript</h3>", unsafe_allow_html=True)

tab_upload, tab_sample = st.tabs(["Upload transcript", "Sample meetings"])

selected_path: Path | None = None
selected_label = ""

with tab_upload:
    uploaded = st.file_uploader(
        "Microsoft Teams transcript export (.docx · .txt · .pdf · .vtt)",
        type=["docx", "txt", "pdf", "vtt"],
        accept_multiple_files=False,
        label_visibility="visible",
    )
    if uploaded is not None:
        suffix = Path(uploaded.name).suffix.lower()
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        tmp.write(uploaded.getbuffer())
        tmp.close()
        selected_path = Path(tmp.name)
        selected_label = uploaded.name

with tab_sample:
    samples = list_samples()
    if not samples:
        st.info(f"No samples in {SAMPLES_DIR}. Run `python _make_samples.py` to generate.")
    else:
        for i in range(0, len(samples), 2):
            row = samples[i:i+2]
            cols = st.columns(2)
            for col, p in zip(cols, row):
                with col:
                    label, desc = SAMPLE_LABELS.get(p.name, (p.stem.replace("_", " "), "Sample transcript."))
                    fmt = p.suffix.upper().lstrip(".")
                    st.markdown(
                        f"""
                        <div class="sample">
                          <span class="fmt">{fmt}</span>
                          <h5>{label}</h5>
                          <p>{desc}</p>
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )
                    if st.button("Use this transcript", key=f"sample_{p.name}", use_container_width=True):
                        st.session_state["picked_sample"] = str(p)

        if st.session_state.get("picked_sample"):
            selected_path = Path(st.session_state["picked_sample"])
            selected_label = selected_path.name


# ============================================================
# Empty state
# ============================================================
if selected_path is None:
    st.markdown("<h3>How it works</h3>", unsafe_allow_html=True)
    h1, h2, h3 = st.columns(3)
    with h1:
        st.markdown(
            """
            <div class="card"><h4 style="color:#86BC25;margin-bottom:6px;">1. Upload transcript</h4>
            <p style="color:#53565A;font-size:13px;line-height:1.55;margin:0;">Provide a Microsoft Teams transcript export, or select one of the sample meetings.</p></div>
            """, unsafe_allow_html=True)
    with h2:
        st.markdown(
            """
            <div class="card"><h4 style="color:#86BC25;margin-bottom:6px;">2. Extraction</h4>
            <p style="color:#53565A;font-size:13px;line-height:1.55;margin:0;">The transcript is cleaned, code-switching is resolved, and decisions, action items and risks are extracted in line with <code>Rules.docx</code>.</p></div>
            """, unsafe_allow_html=True)
    with h3:
        st.markdown(
            """
            <div class="card"><h4 style="color:#86BC25;margin-bottom:6px;">3. Deliverable</h4>
            <p style="color:#53565A;font-size:13px;line-height:1.55;margin:0;">A client-ready Word document is produced, formatted to the team's house style and ready to attach to a follow-up email.</p></div>
            """, unsafe_allow_html=True)

    st.markdown("</div>", unsafe_allow_html=True)
    st.markdown(
        '<div class="footer">AI Meeting Minutes Generator · Deloitte AI Prompting Lab · Strictly Private &amp; Confidential</div>',
        unsafe_allow_html=True,
    )
    st.stop()


# ============================================================
# Process — defaults only
# ============================================================
head_l, head_m, head_r = st.columns([3, 1, 1])
with head_l:
    st.markdown(f"<h3>Generating: {selected_label}</h3>", unsafe_allow_html=True)
with head_m:
    reconstruct_on = st.toggle(
        "Pre-clean",
        value=st.session_state.get("reconstruct_on", False),
        help=("Claude pre-cleaning pass BEFORE extraction — strips fillers (um/ε), "
              "drops pleasantries and audio check-ins, merges same-speaker lines, "
              "fixes false starts, silently translates foreign-language inserts. "
              "Costs +1 Claude call. Adapted from MichalisPanousos/meeting-minutes."),
        key="reconstruct_toggle",
    )
    st.session_state["reconstruct_on"] = reconstruct_on
with head_r:
    review_pass_on = st.toggle(
        "Review pass",
        value=st.session_state.get("review_pass_on", True),
        help=("Second Claude call audits the first extraction — catches missed action items, "
              "mis-classified statuses, pleasantries, and missing decisions. "
              "Costs +1 Claude call. Adapted from MichalisPanousos/meeting-minutes."),
        key="review_pass_toggle",
    )
    st.session_state["review_pass_on"] = review_pass_on
os.environ["ENABLE_REVIEW_PASS"] = "1" if review_pass_on else "0"
os.environ["ENABLE_RECONSTRUCT"] = "1" if reconstruct_on else "0"

# Cache: re-process when the selected sample OR either toggle changes
sample_key = f"{selected_path}|review={review_pass_on}|recon={reconstruct_on}"
if st.session_state.get("processed_for") != sample_key:
    with st.spinner("Reading transcript and preparing the meeting minutes…"):
        t0 = time.time()
        try:
            raw_text, suffix = load_transcript(selected_path)
            st.session_state["cleaned_transcript"] = clean_transcript(raw_text, suffix)
            st.session_state["transcript_label"] = selected_label

            out_path, mom = process_one(selected_path, output_dir=OUTPUT)
            elapsed = time.time() - t0
            st.session_state["mom"] = mom
            st.session_state["out_path"] = str(out_path)
            st.session_state["elapsed"] = elapsed
            st.session_state["processed_for"] = sample_key
        except Exception as e:
            st.error(f"Processing failed: {e}")
            st.stop()
        finally:
            if selected_path and selected_path.parent == Path(tempfile.gettempdir()):
                try: selected_path.unlink()
                except OSError: pass

mom = st.session_state["mom"]
out_path = Path(st.session_state["out_path"])
elapsed = st.session_state.get("elapsed", 0.0)

mi = mom.get("meeting_info", {})

with open(out_path, "rb") as f:
    docx_bytes = f.read()

# Success banner
st.markdown(
    f'<div style="padding:14px 18px;background:#e8f5e9;border-left:4px solid #86BC25;border-radius:6px;margin-top:8px;">'
    f'<strong style="color:#2e7d32;">Document prepared in {elapsed:.1f}s</strong>'
    f'<br><span style="color:#53565A;font-size:13px;">{out_path.name}</span>'
    f'</div>',
    unsafe_allow_html=True,
)

# Action row
b1, b2, b3, b4, b5 = st.columns(5)
with b1:
    if st.button(
        "Preview on screen",
        use_container_width=True,
        type="primary" if not st.session_state.get("show_results") else "secondary",
        help="Toggle the on-screen document preview",
    ):
        st.session_state["show_results"] = not st.session_state.get("show_results", False)
with b2:
    if st.button(
        "View transcript",
        use_container_width=True,
        type="primary" if not st.session_state.get("show_transcript") else "secondary",
        help="Toggle the cleaned transcript",
    ):
        st.session_state["show_transcript"] = not st.session_state.get("show_transcript", False)
with b3:
    if st.button(
        "Quality check",
        use_container_width=True,
        type="primary" if not st.session_state.get("show_quality") else "secondary",
        help="Verify the document is professional and ready to send",
    ):
        st.session_state["show_quality"] = not st.session_state.get("show_quality", False)
        if st.session_state["show_quality"]:
            with st.spinner("Running quality check…"):
                rules_t = _load_rules_from(RULES_DOC) if RULES_DOC.exists() else ""
                tx_text = "\n".join(
                    f"{u.get('speaker','')}: {u.get('text','')}"
                    for u in (st.session_state.get("cleaned_transcript") or {}).get("utterances", [])
                )
                st.session_state["quality_result"] = quick_quality_check_with_llm(mom, tx_text, rules_t)
with b4:
    if st.button(
        "Email draft",
        use_container_width=True,
        help="Open Outlook with the document attached and a pre-filled body",
    ):
        ok, msg = open_outlook_draft(
            attachment=out_path,
            meeting_title=mi.get("title", "") or "",
            meeting_date=mi.get("date", "") or "",
            summary=mom.get("executive_summary", "") or "",
            actions=mom.get("action_items") or [],
            client_name=mi.get("client_name", "") or "",
        )
        st.session_state["mailer_msg"] = msg
        st.session_state["mailer_ok"] = ok
with b5:
    st.download_button(
        label="Download Word",
        data=docx_bytes,
        file_name=out_path.name,
        mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        use_container_width=True,
        key="dl",
    )

# Mailer feedback line (transient)
if st.session_state.get("mailer_msg"):
    if st.session_state.get("mailer_ok"):
        st.success(st.session_state["mailer_msg"])
    else:
        st.warning(st.session_state["mailer_msg"])


# ============================================================
# Edit MoM — manual polish before sending
# ============================================================
with st.expander("Edit MoM  ·  manually adjust any section before exporting"):
    st.caption(
        "Edit any field below and click **Save changes**. The Word document on disk is "
        "regenerated immediately, so your next download or Outlook draft will use the edits."
    )

    mi = mom.get("meeting_info", {}) or {}
    e_col1, e_col2, e_col3 = st.columns(3)
    new_title = e_col1.text_input("Title", value=mi.get("title", ""), key="ed_title")
    new_date = e_col2.text_input("Date", value=mi.get("date", ""), key="ed_date")
    new_duration = e_col3.text_input("Duration", value=mi.get("duration", ""), key="ed_duration")
    e_col4, e_col5 = st.columns(2)
    new_client = e_col4.text_input("Client", value=mi.get("client_name", ""), key="ed_client")
    new_language = e_col5.text_input("Language", value=mi.get("language", ""), key="ed_language")
    new_objective = st.text_area("Objective", value=mi.get("objective", ""), height=70, key="ed_objective")

    # Attendees as a single text area (one per line, "Name (Org)")
    parts_lines = []
    for p in mi.get("participants", []) or []:
        if isinstance(p, dict):
            n = p.get("name", "")
            o = p.get("organization", "")
            parts_lines.append(f"{n} ({o})" if o else n)
        else:
            parts_lines.append(str(p))
    new_attendees_text = st.text_area(
        "Attendees (one per line, optionally 'Name (Organization)')",
        value="\n".join(parts_lines),
        height=120,
        key="ed_attendees",
    )

    new_summary = st.text_area(
        "Executive summary",
        value=mom.get("executive_summary", ""),
        height=140,
        key="ed_summary",
    )

    # ----- Tables -----
    st.markdown("**Discussion topics**")
    edited_topics = st.data_editor(
        mom.get("discussion_topics", []) or [{"title": "", "summary": ""}],
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "title": st.column_config.TextColumn("Title", width="medium"),
            "summary": st.column_config.TextColumn("Summary", width="large"),
        },
        key="ed_topics",
    )

    st.markdown("**Decisions**")
    edited_decisions = st.data_editor(
        mom.get("decisions_log", []) or [{"decision": "", "rationale": "", "owner": ""}],
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "decision": st.column_config.TextColumn("Decision", width="large"),
            "rationale": st.column_config.TextColumn("Rationale", width="medium"),
            "owner": st.column_config.TextColumn("Owner", width="small"),
        },
        key="ed_decisions",
    )

    st.markdown("**Action items**")
    edited_actions = st.data_editor(
        mom.get("action_items", []) or [{"action": "", "owner": "", "due_date": "TBD",
                                          "priority": "Medium", "status": "Not Started"}],
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "action": st.column_config.TextColumn("Action", width="large"),
            "owner": st.column_config.TextColumn("Owner", width="small"),
            "due_date": st.column_config.TextColumn("Due", width="small"),
            "priority": st.column_config.SelectboxColumn("Priority", options=["High", "Medium", "Low"], width="small"),
            "status": st.column_config.SelectboxColumn("Status", options=["Not Started", "In Progress", "Completed"], width="small"),
        },
        key="ed_actions",
    )

    st.markdown("**Risks & Issues**")
    edited_risks = st.data_editor(
        mom.get("risks_issues", []) or [{"type": "Risk", "description": "", "impact": "Medium", "owner": ""}],
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "type": st.column_config.SelectboxColumn("Type", options=["Risk", "Issue"], width="small"),
            "description": st.column_config.TextColumn("Description", width="large"),
            "impact": st.column_config.SelectboxColumn("Impact", options=["High", "Medium", "Low"], width="small"),
            "owner": st.column_config.TextColumn("Owner", width="small"),
        },
        key="ed_risks",
    )

    st.markdown("**Key dates**")
    edited_timeline = st.data_editor(
        mom.get("timeline", []) or [{"milestone": "", "date": ""}],
        num_rows="dynamic",
        use_container_width=True,
        column_config={
            "milestone": st.column_config.TextColumn("Milestone", width="large"),
            "date": st.column_config.TextColumn("Date", width="small"),
        },
        key="ed_timeline",
    )

    new_questions = st.text_area(
        "Open questions (one per line)",
        value="\n".join(mom.get("open_questions", []) or []),
        height=90,
        key="ed_questions",
    )

    save_col, _, reset_col = st.columns([1, 3, 1])
    with save_col:
        if st.button("Save changes", type="primary", use_container_width=True, key="save_edits"):
            try:
                from run import render_mom as _render_mom

                # Build updated participants list
                updated_parts = []
                for line in (new_attendees_text or "").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    m = re.match(r"^(.+?)\s*\(([^)]+)\)\s*$", line)
                    if m:
                        updated_parts.append({"name": m.group(1).strip(), "role": "", "organization": m.group(2).strip()})
                    else:
                        updated_parts.append({"name": line, "role": "", "organization": ""})

                updated_mi = dict(mom.get("meeting_info", {}))
                updated_mi.update({
                    "title": new_title,
                    "date": new_date,
                    "duration": new_duration,
                    "client_name": new_client,
                    "language": new_language,
                    "objective": new_objective,
                    "participants": updated_parts,
                })
                updated_mom = dict(mom)
                updated_mom["meeting_info"] = updated_mi
                updated_mom["executive_summary"] = new_summary
                updated_mom["discussion_topics"] = [
                    {k: r.get(k, "") for k in ("title", "summary")}
                    for r in (edited_topics or []) if (r.get("title") or r.get("summary"))
                ]
                updated_mom["decisions_log"] = [
                    {k: r.get(k, "") for k in ("decision", "rationale", "owner")}
                    for r in (edited_decisions or []) if r.get("decision")
                ]
                updated_mom["action_items"] = [
                    {k: r.get(k, "") for k in ("action", "owner", "due_date", "priority", "status")}
                    for r in (edited_actions or []) if r.get("action")
                ]
                updated_mom["risks_issues"] = [
                    {k: r.get(k, "") for k in ("type", "description", "impact", "owner")}
                    for r in (edited_risks or []) if r.get("description")
                ]
                updated_mom["timeline"] = [
                    {k: r.get(k, "") for k in ("milestone", "date")}
                    for r in (edited_timeline or []) if r.get("milestone")
                ]
                updated_mom["open_questions"] = [q.strip() for q in (new_questions or "").splitlines() if q.strip()]

                _render_mom(updated_mom, out_path)
                st.session_state["mom"] = updated_mom
                st.success(f"Saved. The Word document at {out_path.name} has been regenerated with your edits.")
                st.rerun()
            except Exception as e:
                st.error(f"Could not save edits: {e}")
    with reset_col:
        if st.button("Discard edits", use_container_width=True, key="discard_edits"):
            # Force re-process on next run
            st.session_state.pop("processed_for", None)
            st.rerun()

# ============================================================
# Continuous-learning feedback panel
# ============================================================
with st.expander("Help improve future minutes  ·  feedback shapes Rules.docx for next runs"):
    stats = feedback_stats()
    st.caption(
        f"Recorded so far: {stats['total']} feedback item(s) "
        f"·  {stats['thumbs_up']} positive  ·  {stats['thumbs_down']} negative  "
        f"·  {stats['applied']} rules added from feedback"
    )

    fb_col_l, fb_col_r = st.columns([1, 4])
    with fb_col_l:
        rating = st.radio(
            "Rating",
            options=["", "Useful", "Needs work"],
            label_visibility="collapsed",
            key="fb_rating",
            horizontal=False,
        )
    with fb_col_r:
        comment = st.text_area(
            "What should be different next time? (optional)",
            placeholder="e.g. 'Action items should always include the client name in the description.'",
            key="fb_comment",
            height=90,
        )

    submit_col, _ = st.columns([1, 4])
    with submit_col:
        if st.button("Submit feedback", use_container_width=True, type="primary"):
            entry = {
                "transcript": st.session_state.get("transcript_label", ""),
                "rating": {"Useful": "thumbs_up", "Needs work": "thumbs_down"}.get(rating),
                "comment": comment.strip(),
                "rule_amendment_proposed": None,
                "rule_amendment_applied": False,
            }
            # Try to get an AI-suggested rule amendment if the user added a comment
            if comment.strip():
                from run import _load_rules_from
                rules_text = _load_rules_from(RULES_DOC) if RULES_DOC.exists() else ""
                proposed = propose_rule_amendment(comment.strip(), rules_text)
                entry["rule_amendment_proposed"] = proposed
                st.session_state["pending_amendment"] = proposed
            log_feedback(entry)
            if entry["rule_amendment_proposed"]:
                st.success("Feedback saved. A suggested rule update is shown below — click Apply to add it to Rules.docx.")
            elif comment.strip() and not api_key_set:
                st.success("Feedback saved. Set ANTHROPIC_API_KEY to also receive an AI-proposed rule update for this comment.")
            else:
                st.success("Feedback saved.")

    # Show pending amendment + Apply button
    pending = st.session_state.get("pending_amendment")
    if pending:
        st.markdown(
            f"""
            <div style="margin-top:12px;padding:14px 18px;background:#f5f9fa;border-left:4px solid #0076A8;border-radius:6px;">
              <strong style="color:#000;font-size:13px;">Suggested rule update</strong>
              <div style="margin-top:6px;color:#1a1a1a;font-size:13px;line-height:1.55;">{pending}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        ap1, ap2, _ = st.columns([1, 1, 4])
        with ap1:
            if st.button("Apply to Rules", use_container_width=True, type="primary", key="apply_amendment"):
                try:
                    apply_rule_amendment(pending)
                    # Mark the most recent feedback entry as applied
                    log_feedback({
                        "transcript": st.session_state.get("transcript_label", ""),
                        "rating": None,
                        "comment": "(rule applied)",
                        "rule_amendment_proposed": pending,
                        "rule_amendment_applied": True,
                    })
                    st.session_state.pop("pending_amendment", None)
                    st.success("Rule added. Future generations will use it automatically.")
                except Exception as e:
                    st.error(f"Could not apply amendment: {e}")
        with ap2:
            if st.button("Discard", use_container_width=True, key="discard_amendment"):
                st.session_state.pop("pending_amendment", None)
                st.rerun()

    # Recent history
    history = recent_feedback(limit=5)
    if history:
        st.caption("Most recent feedback:")
        for h in history:
            ts = h.get("timestamp", "")[:16].replace("T", " ")
            tx = h.get("transcript", "")
            rating_txt = {"thumbs_up": "👍", "thumbs_down": "👎"}.get(h.get("rating") or "", "")
            applied = " ·  rule applied" if h.get("rule_amendment_applied") else ""
            st.caption(f"  {ts}  ·  {tx}  {rating_txt}{applied}")
            if h.get("comment") and h["comment"] != "(rule applied)":
                st.caption(f"    “{h['comment']}”")


# Optional quality-check panel
if st.session_state.get("show_quality"):
    q = st.session_state.get("quality_result") or quick_quality_check(mom)
    grade_color = {
        "A": "#2e7d32", "B": "#558b2f", "C": "#e65100", "D": "#bf360c", "F": "#c62828"
    }.get(q["grade"], "#53565A")
    sr = q["send_ready_detail"]
    sr_rows = "".join(
        f'<tr><td style="padding:4px 0;font-size:12.5px;">{k.replace("_", " ").capitalize()}</td>'
        f'<td style="padding:4px 0;text-align:right;color:{"#2e7d32" if v else "#c62828"};font-weight:700;">'
        f'{"✓ Pass" if v else "✗ Fail"}</td></tr>'
        for k, v in sr.items()
    )
    fail_count = sum(1 for v in sr.values() if not v)
    overall_msg = (
        "Ready to send to a senior client." if q["grade"] in ("A", "B") and fail_count == 0
        else "Acceptable, but minor issues should be reviewed before sending." if q["grade"] in ("A", "B")
        else "Not ready — please review the failed checks below before forwarding."
    )
    # LLM judge panel (only if available)
    llm_block = ""
    if q.get("llm"):
        j = q["llm"]
        llm_block = f"""
        <div style="margin-top:14px;padding:14px 18px;background:#f5f9fa;border-left:4px solid #0076A8;border-radius:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="color:#000;font-size:13px;">Claude as judge</strong>
            <span style="background:#e3f2fd;color:#0d47a1;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:700;">{j['score']}% · Grade {q.get('combined_grade', '')}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:10px;">
            <div style="background:#fff;padding:10px;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:700;color:#000;">{j['tone']}/10</div><div style="font-size:10px;color:#53565A;text-transform:uppercase;letter-spacing:.4px;">Tone</div></div>
            <div style="background:#fff;padding:10px;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:700;color:#000;">{j['completeness']}/10</div><div style="font-size:10px;color:#53565A;text-transform:uppercase;letter-spacing:.4px;">Completeness</div></div>
            <div style="background:#fff;padding:10px;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:700;color:#000;">{j['accuracy']}/10</div><div style="font-size:10px;color:#53565A;text-transform:uppercase;letter-spacing:.4px;">Accuracy</div></div>
            <div style="background:#fff;padding:10px;border-radius:6px;text-align:center;"><div style="font-size:18px;font-weight:700;color:#000;">{j['structure']}/10</div><div style="font-size:10px;color:#53565A;text-transform:uppercase;letter-spacing:.4px;">Structure</div></div>
          </div>
          <div style="font-size:13px;color:#1a1a1a;line-height:1.5;font-style:italic;">{escape(j.get('critique', ''))}</div>
        </div>
        """
    elif q.get("llm_error"):
        llm_block = f"""
        <div style="margin-top:14px;padding:10px 14px;background:#ffebee;border-left:4px solid #c62828;border-radius:6px;font-size:12px;color:#c62828;">
          Claude judge unavailable: {escape(q['llm_error'])}
        </div>
        """
    st.markdown(
        f"""
        <style>
          .qc {{ background:#fff; padding:24px 32px; border-radius:10px; box-shadow:0 4px 14px rgba(0,0,0,.06); margin-top:14px; }}
          .qc .qc-head {{ display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }}
          .qc h4 {{ font-size:15px; color:#000; margin:0; font-weight:700; }}
          .qc .grade-block {{ text-align:right; }}
          .qc .grade-num {{ font-size:36px; font-weight:700; color:{grade_color}; line-height:1; }}
          .qc .grade-letter {{ font-size:12px; color:#53565A; }}
          .qc .qc-msg {{ color:#53565A; font-size:13px; margin-bottom:14px; }}
          .qc .qc-kpis {{ display:flex; gap:14px; margin-bottom:14px; }}
          .qc .qc-kpi {{ flex:1; background:#fafafa; border-radius:6px; padding:12px 14px; text-align:center; }}
          .qc .qc-kpi .num {{ font-size:22px; font-weight:700; color:#000; }}
          .qc .qc-kpi .lbl {{ font-size:10px; color:#53565A; text-transform:uppercase; letter-spacing:.4px; }}
          .qc table {{ width:100%; }}
          .qc table td {{ border-bottom:1px solid #f0f0f0; }}
        </style>
        <div class="qc">
          <div class="qc-head">
            <h4>Quality check</h4>
            <div class="grade-block">
              <div class="grade-num">{q['total']}%</div>
              <div class="grade-letter">Grade {q['grade']}</div>
            </div>
          </div>
          <div class="qc-msg">{overall_msg}</div>
          <div class="qc-kpis">
            <div class="qc-kpi"><div class="num">{q['structure']}%</div><div class="lbl">Structure</div></div>
            <div class="qc-kpi"><div class="num">{q['hygiene']}%</div><div class="lbl">Hygiene</div></div>
            <div class="qc-kpi"><div class="num">{q['send_ready']}%</div><div class="lbl">Send-ready</div></div>
          </div>
          <table>{sr_rows}</table>
          {llm_block}
        </div>
        """,
        unsafe_allow_html=True,
    )


# Optional transcript panel (shown above the doc preview when toggled)
if st.session_state.get("show_transcript"):
    cleaned = st.session_state.get("cleaned_transcript")
    if cleaned and cleaned.get("utterances"):
        n_utts = len(cleaned["utterances"])
        n_speakers = len(cleaned["speakers"])
        utts = cleaned["utterances"]
        n_changed = sum(
            1 for u in utts
            if (u.get("raw_text") or "").strip() != (u.get("text") or "").strip()
        )

        toggle_col, _ = st.columns([2, 5])
        with toggle_col:
            show_corrections = st.toggle(
                "Show AI corrections",
                value=st.session_state.get("show_corrections", False),
                help="Reveal the original text with the AI's removals (red strike-through) and additions (green) inline.",
            )
            st.session_state["show_corrections"] = show_corrections

        st.markdown(
            f"""
            <style>
              .transcript-card {{ background:#fff; padding:28px 36px; border-radius:10px; box-shadow:0 4px 14px rgba(0,0,0,.06); margin-top:6px; max-height:560px; overflow-y:auto; }}
              .transcript-card h4 {{ color:#000; margin:0 0 4px 0; font-size:16px; font-weight:700; }}
              .transcript-card .tx-meta {{ color:#53565A; font-size:12px; margin-bottom:14px; }}
              .transcript-card .turn {{ padding:10px 0; border-bottom:1px solid #f3f3f3; }}
              .transcript-card .speaker {{ font-weight:700; color:#000; font-size:13px; }}
              .transcript-card .ts {{ color:#999; font-size:11px; margin-left:8px; }}
              .transcript-card .edited-tag {{ display:inline-block; margin-left:8px; padding:1px 7px; border-radius:8px; background:#fff8e1; color:#e65100; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; }}
              .transcript-card .text {{ color:#1a1a1a; font-size:13px; line-height:1.65; margin-top:2px; }}
              .transcript-card .original {{ color:#999; font-size:12.5px; line-height:1.65; margin-top:4px; font-style:italic; }}
              .transcript-card .original .label {{ font-size:10px; color:#888; font-weight:700; letter-spacing:.4px; text-transform:uppercase; margin-right:6px; }}
            </style>
            <div class="transcript-card">
              <h4>{"Original vs cleaned transcript" if show_corrections else "Cleaned transcript"}</h4>
              <div class="tx-meta">{n_utts} turns &nbsp;·&nbsp; {n_speakers} speakers &nbsp;·&nbsp; {n_changed} edited &nbsp;·&nbsp; {st.session_state.get("transcript_label", "")}</div>
            """,
            unsafe_allow_html=True,
        )
        if show_corrections:
            # Side-by-side: Original (left) | AI-corrected (right)
            st.markdown(
                """
                <style>
                  .sxs-grid { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
                  .sxs-col-head { font-size:11px; font-weight:700; color:#fff; text-transform:uppercase; letter-spacing:.5px; padding:6px 10px; border-radius:4px; margin-bottom:8px; }
                  .sxs-col-head.original { background:#9e9e9e; }
                  .sxs-col-head.cleaned { background:#86BC25; }
                  .sxs-turn-l, .sxs-turn-r { padding:10px 12px; border-radius:6px; margin-bottom:8px; min-height:30px; }
                  .sxs-turn-l { background:#fafafa; }
                  .sxs-turn-r { background:#fff; border:1px solid #f3f3f3; }
                  .sxs-turn-edited { border-left:3px solid #f9a825; }
                  .sxs-meta { font-size:11px; color:#999; margin-bottom:3px; }
                  .sxs-meta b { color:#000; font-weight:700; }
                  .sxs-text { color:#1a1a1a; font-size:12.5px; line-height:1.55; }
                  .sxs-text.gray { color:#666; }
                </style>
                """,
                unsafe_allow_html=True,
            )

            # Header row
            head_l, head_r = st.columns(2)
            head_l.markdown('<div class="sxs-col-head original">Original transcript</div>', unsafe_allow_html=True)
            head_r.markdown('<div class="sxs-col-head cleaned">AI-corrected (used by the model)</div>', unsafe_allow_html=True)

            # One pair of cells per turn
            for u in utts:
                speaker = escape(u.get("speaker", ""))
                ts = u.get("ts", "") or ""
                cleaned_text = u.get("text", "") or ""
                raw_text = u.get("raw_text", "") or cleaned_text
                diff_html, changed = _diff_inline(raw_text, cleaned_text)
                edited_cls = " sxs-turn-edited" if changed else ""

                left = (
                    f'<div class="sxs-turn-l{edited_cls}">'
                    f'<div class="sxs-meta"><b>{speaker}</b> &middot; {ts}</div>'
                    f'<div class="sxs-text gray">{diff_html}</div>'
                    f'</div>'
                )
                right = (
                    f'<div class="sxs-turn-r{edited_cls}">'
                    f'<div class="sxs-meta"><b>{speaker}</b> &middot; {ts}</div>'
                    f'<div class="sxs-text">{escape(cleaned_text)}</div>'
                    f'</div>'
                )
                col_l, col_r = st.columns(2)
                col_l.markdown(left, unsafe_allow_html=True)
                col_r.markdown(right, unsafe_allow_html=True)
        else:
            for u in utts:
                speaker = escape(u.get("speaker", ""))
                ts = u.get("ts", "") or ""
                cleaned_text = u.get("text", "") or ""
                st.markdown(
                    f'<div class="turn"><span class="speaker">{speaker}</span>'
                    f'<span class="ts">{ts}</span>'
                    f'<div class="text">{escape(cleaned_text)}</div></div>',
                    unsafe_allow_html=True,
                )
        st.markdown("</div>", unsafe_allow_html=True)
    else:
        st.info("Transcript not available — please re-process the file.")

if not st.session_state.get("show_results"):
    st.markdown(
        '<div style="margin-top:14px;padding:12px 16px;background:#fafafa;border-radius:6px;color:#53565A;font-size:13px;">'
        'Select <strong>Preview on screen</strong> to inspect the meeting minutes inline, '
        '<strong>View transcript</strong> to see the cleaned source, '
        'or <strong>Download Word</strong> to forward the file to your client.'
        '</div>',
        unsafe_allow_html=True,
    )
    b1, b2 = st.columns([1, 4])
    with b1:
        if st.button("↻ Process another", use_container_width=True, key="another_compact"):
            for k in ("picked_sample", "show_results", "show_transcript",
                      "cleaned_transcript", "transcript_label",
                      "show_quality", "quality_result", "pending_amendment",
                      "show_corrections", "mailer_msg", "mailer_ok",
                      "mom", "out_path", "elapsed", "processed_for"):
                st.session_state.pop(k, None)
            st.rerun()
    st.markdown("</div>", unsafe_allow_html=True)
    st.markdown(
        '<div class="footer">AI Meeting Minutes Generator · Deloitte AI Prompting Lab · Strictly Private &amp; Confidential</div>',
        unsafe_allow_html=True,
    )
    st.stop()

# ============================================================
# Document preview — mirrors the Word doc 1:1
# ============================================================
parts = mi.get("participants", [])
attendee_names = ", ".join(_fmt_attendee(p) for p in parts) or "—"

# Open document-preview container with paper-like styling
st.markdown(
    """
    <style>
      .doc { background:#fff; padding:48px 56px; border-radius:10px; box-shadow:0 4px 18px rgba(0,0,0,.08); margin-top:16px; }
      .doc .eyebrow { color:#86BC25; font-weight:700; font-size:11px; letter-spacing:1px; }
      .doc .doc-title { color:#000; font-weight:700; font-size:30px; margin-top:2px; line-height:1.15; }
      .doc .doc-sub { color:#53565A; font-size:13px; margin-top:6px; }
      .doc .info-table { width:100%; margin-top:18px; font-size:13px; border:none; }
      .doc .info-table td { padding:4px 0; vertical-align:top; }
      .doc .info-table td.k { color:#53565A; font-weight:700; width:120px; }
      .doc .band { color:#86BC25; font-weight:700; font-size:13px; letter-spacing:.5px; margin:30px 0 4px 0; }
      .doc .band-rule { height:2px; background:#86BC25; opacity:.55; margin-bottom:14px; }
      .doc p.summary { font-size:13.5px; line-height:1.7; color:#1a1a1a; margin-bottom:14px; }
      .doc .topic { font-size:13.5px; line-height:1.7; margin-bottom:8px; }
      .doc .topic strong { color:#000; }
      .doc ul.bullets { margin:0 0 0 18px; padding:0; font-size:13.5px; line-height:1.65; }
      .doc ul.bullets li { margin-bottom:6px; }
      .doc table.t { width:100%; border-collapse:collapse; font-size:12.5px; margin-top:6px; }
      .doc table.t th { background:#1A1A1A; color:#fff; font-weight:700; text-align:left; padding:8px 10px; font-size:11.5px; text-transform:uppercase; letter-spacing:.4px; }
      .doc table.t td { padding:8px 10px; border-bottom:1px solid #eee; vertical-align:top; }
      .doc table.t tr:nth-child(odd) td { background:#fafafa; }
      .doc table.t td.cell-high { background:#ffebee !important; color:#c62828; font-weight:700; }
      .doc table.t td.cell-med  { background:#fff8e1 !important; color:#e65100; font-weight:700; }
      .doc table.t td.cell-low  { background:#e8f5e9 !important; color:#2e7d32; font-weight:700; }
      .doc .footnote { margin-top:32px; padding-top:14px; border-top:1px solid #eee; }
      .doc .conf { color:#53565A; font-weight:700; font-size:11px; }
      .doc .issued { color:#999; font-size:10px; margin-top:4px; }
      .doc .empty { color:#999; font-size:12px; font-style:italic; margin:6px 0 4px 0; }
    </style>
    """,
    unsafe_allow_html=True,
)


def _cell_class(value: str) -> str:
    v = (value or "").lower()
    if v == "high": return "cell-high"
    if v == "medium": return "cell-med"
    if v == "low": return "cell-low"
    return ""


# ----- Document open + header -----
doc_html: list[str] = ['<div class="doc">']
doc_html.append('<div class="eyebrow">MEETING MINUTES</div>')
doc_html.append(f'<div class="doc-title">{mi.get("title", "Meeting")}</div>')
sub = "  ·  ".join([s for s in [mi.get("date", ""), mi.get("duration", "")] if s])
if sub:
    doc_html.append(f'<div class="doc-sub">{sub}</div>')

# Header info table
doc_html.append('<table class="info-table">')
if mi.get("client_name"):
    doc_html.append(f'<tr><td class="k">Client</td><td><strong>{mi["client_name"]}</strong></td></tr>')
if parts:
    doc_html.append(f'<tr><td class="k">Attendees</td><td>{attendee_names}</td></tr>')
if mi.get("objective"):
    doc_html.append(f'<tr><td class="k">Objective</td><td>{mi["objective"]}</td></tr>')
if mi.get("language"):
    doc_html.append(f'<tr><td class="k">Language</td><td>{mi["language"]}</td></tr>')
doc_html.append('</table>')


def _band(html: list[str], title: str) -> None:
    html.append(f'<div class="band">{title.upper()}</div><div class="band-rule"></div>')


# ----- What Was Discussed -----
if mom.get("executive_summary") or mom.get("discussion_topics"):
    _band(doc_html, "What Was Discussed")
    if mom.get("executive_summary"):
        doc_html.append(f'<p class="summary">{mom["executive_summary"]}</p>')
    for t in mom.get("discussion_topics") or []:
        title_html = t.get("title", "Topic")
        summary_html = t.get("summary", "")
        doc_html.append(f'<div class="topic">• <strong>{title_html}:</strong> {summary_html}</div>')

# ----- Decisions -----
decisions = mom.get("decisions_log") or []
if decisions:
    _band(doc_html, "Decisions")
    doc_html.append('<ul class="bullets">')
    for d in decisions:
        line = f'<strong>{d.get("decision", "")}</strong>'
        if d.get("rationale"):
            line += f' — <em style="color:#53565A;">{d["rationale"]}</em>'
        if d.get("owner"):
            line += f'  <span style="color:#53565A;">({d["owner"]})</span>'
        doc_html.append(f'<li>{line}</li>')
    doc_html.append('</ul>')

# ----- Next Steps & Action Items -----
actions = mom.get("action_items") or []
if actions:
    _band(doc_html, "Next Steps & Action Items")
    doc_html.append('<table class="t"><thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead><tbody>')
    for a in actions:
        cls = _cell_class(a.get("priority", ""))
        due = (a.get("due_date") or "").strip() or "TBD"
        status = (a.get("status") or "").strip() or "Not Started"
        doc_html.append(
            f'<tr>'
            f'<td>{a.get("action", "")}</td>'
            f'<td>{a.get("owner", "")}</td>'
            f'<td>{due}</td>'
            f'<td class="{cls}">{a.get("priority", "")}</td>'
            f'<td>{status}</td>'
            f'</tr>'
        )
    doc_html.append('</tbody></table>')

# ----- Risks & Issues -----
risks = mom.get("risks_issues") or []
if risks:
    _band(doc_html, "Risks & Issues")
    doc_html.append('<table class="t"><thead><tr><th>Type</th><th>Description</th><th>Impact</th><th>Owner</th></tr></thead><tbody>')
    for r in risks:
        cls = _cell_class(r.get("impact", ""))
        doc_html.append(
            f'<tr>'
            f'<td>{r.get("type", "")}</td>'
            f'<td>{r.get("description", "")}</td>'
            f'<td class="{cls}">{r.get("impact", "")}</td>'
            f'<td>{r.get("owner", "")}</td>'
            f'</tr>'
        )
    doc_html.append('</tbody></table>')

# ----- Key Dates -----
timeline = mom.get("timeline") or []
if timeline:
    _band(doc_html, "Key Dates")
    doc_html.append('<table class="t"><thead><tr><th>Milestone</th><th>Date</th></tr></thead><tbody>')
    for t in timeline:
        doc_html.append(f'<tr><td>{t.get("milestone", "")}</td><td><strong>{t.get("date", "")}</strong></td></tr>')
    doc_html.append('</tbody></table>')

# ----- Open Questions -----
questions = mom.get("open_questions") or []
if questions:
    _band(doc_html, "Open Questions")
    doc_html.append('<ul class="bullets">')
    for q in questions:
        doc_html.append(f'<li>{q}</li>')
    doc_html.append('</ul>')

# ----- Footer -----
doc_html.append('<div class="footnote">')
doc_html.append('<div class="conf">Strictly Private &amp; Confidential</div>')
doc_html.append(f'<div class="issued">Issued {datetime_str()}  ·  Generated by the AI Meeting Minutes Generator  ·  Deloitte AI Prompting Lab</div>')
doc_html.append('</div>')

doc_html.append('</div>')  # close .doc
st.markdown("".join(doc_html), unsafe_allow_html=True)

st.markdown("<br>", unsafe_allow_html=True)
b1, b2 = st.columns([1, 4])
with b1:
    if st.button("↻ Process another", use_container_width=True):
        for k in ("picked_sample", "show_results", "show_transcript",
                  "cleaned_transcript", "transcript_label",
                  "show_quality", "quality_result", "pending_amendment",
                  "show_corrections", "mailer_msg", "mailer_ok",
                  "mom", "out_path", "elapsed", "processed_for"):
            st.session_state.pop(k, None)
        st.rerun()

st.markdown("</div>", unsafe_allow_html=True)
st.markdown(
    '<div class="footer">AI Meeting Minutes Generator · Deloitte AI Prompting Lab · Strictly Private &amp; Confidential</div>',
    unsafe_allow_html=True,
)
