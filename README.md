# AI Meeting Minutes Generator

Drop a Teams transcript → run → get a professional MoM Word doc, ready to email.

> **Submission case study:** [case_study.html](case_study.html) — open in a browser for the executive-grade narrative (problem, solution, architecture, ROI, differentiators, roadmap).

```
09_convert_transcript_to_moms/
├── run.py                ← the only script
├── _build_inputs.py      ← (re)generates Rules.docx + Template.docx from scratch
├── requirements.txt
├── .env.example
├── input/
│   ├── Rules.docx        ← writing rules (the AI reads these every run)
│   ├── Template.docx     ← visual template (styles carry into the output)
│   └── Transcript.docx   ← the meeting transcript (also accepts .txt / .pdf / .vtt)
└── output/
    └── <date>_<meeting>_MoM.docx
```

## Setup (once)

```powershell
pip install -r requirements.txt
copy .env.example .env       # then add ANTHROPIC_API_KEY=sk-ant-...
python _build_inputs.py      # generates Rules.docx + Template.docx if missing
```

## Each meeting — two ways

### A. UI (recommended)

```powershell
streamlit run ui.py
```

Browser opens at http://localhost:8501. Drag-and-drop the transcript → see decisions, actions, owners → click Download → attach to email.

### B. CLI

1. Drop the Teams transcript into `input/` (replace `Transcript.docx`).
2. `python run.py`
3. Find the MoM in `output/`. Attach to email. Send.

## Customizing

- **Change how the AI writes** → edit `input/Rules.docx` in Word.
- **Change the visual style** → edit `input/Template.docx` in Word (fonts, colors).

Both are read fresh on every run.

## Provider

- If `ANTHROPIC_API_KEY` is set → uses Claude (`claude-sonnet-4-6`) for clean, executive prose.
- If not set → deterministic rule-based fallback so the pipeline still runs (output is functional but not polished).
