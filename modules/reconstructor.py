"""
reconstructor.py
Pre-extraction Claude pass that does language-level cleanup — the kind of
cleanup that requires semantic understanding, beyond what the regex-based
`clean_transcript` can do. Adapted from MichalisPanousos/meeting-minutes
and made bilingual (English / Greek / mixed).

Output: a cleaned transcript string that replaces the input to the extractor.
"""

import logging
import os

log = logging.getLogger(__name__)


RECONSTRUCT_SYSTEM = """You are a transcript pre-processing assistant. You are given a raw meeting transcript from Microsoft Teams. The meeting may be in English, Greek, or a mix.

Apply these rules IN ORDER:

RULE 01 — Strip speech fillers
Remove content-free words and phrases. The result must read as professional prose.
- English: "um", "uh", "er", "you know", "I mean", "kind of", "like" (as filler), "sort of"
- Greek: "ε", "ε ε", "α", "μμμ", "χμμ", "ναι ναι" (as filler), "δηλαδή" (as filler), "ξέρεις", "εννοώ", "κάπως έτσι"

RULE 02 — Drop pleasantries and side comments
- Greetings: "good morning", "hi everyone", "καλημέρα", "γεια σε όλους"
- Farewells: "thanks for joining", "bye", "ευχαριστώ για τη συμμετοχή", "αντίο"
- Audio check-ins: "can you hear me?", "I was on mute", "are you there?", "με ακούτε;", "ήμουν σε σίγαση"

RULE 03 — Remove transcription artifacts
Drop bracketed markers entirely: [silence], [unclear], [inaudible], [laughter], [crosstalk], [σιγή], [ακατάληπτο], [γέλια], [σταυρωτές ομιλίες], and any other bracketed annotation.

RULE 04 — Merge consecutive lines from the same speaker
Teams often splits long contributions across multiple short lines. Combine consecutive lines from the same speaker into one coherent thought.

RULE 05 — Fix false starts
"we — we expect..." → "we expect..."
"εμείς — εμείς περιμένουμε..." → "εμείς περιμένουμε..."
Drop the false start, keep the completed phrase.

RULE 06 — Translate foreign-language inserts silently
If a phrase appears in a language different from the meeting's primary language (e.g. an English aside mid-Greek conversation, or vice versa), translate it silently into the primary language. Do not annotate the translation.

RULE 07 — Preserve speaker names exactly
Keep names as they appear in the transcript — first-name vs full-name reconciliation happens later.

RULE 08 — Drop audio/connection issues
Skip: "sorry I'm late", "VPN trouble", "someone at the door", "you're cutting out",
"συγγνώμη που άργησα", "πρόβλημα VPN", "κάποιος στην πόρτα", "κόβεται η γραμμή".

OUTPUT RULES
- Return ONLY the cleaned transcript text — no preamble, no commentary, no markdown fences
- Preserve the "Speaker: text" format on each line
- Preserve the meeting's primary language (translate foreign inserts INTO it, not OUT of it)"""


def reconstruct_transcript(cleaned_text, *, model=None, temperature=0.0, max_tokens=8000):
    """
    Run a Claude pre-cleaning pass over the deterministically-cleaned transcript.
    Returns the reconstructed text.

    Raises on failure — caller decides whether to fall back to the original.
    """
    import anthropic

    client = anthropic.Anthropic()
    model = model or os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")

    log.info(f"Reconstruct pass: Claude ({model}, temp={temperature})...")
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=RECONSTRUCT_SYSTEM,
        messages=[{"role": "user", "content": cleaned_text}],
    )
    parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
    if not parts:
        raise RuntimeError("Reconstruct pass: Anthropic returned no text content")
    return "\n".join(parts).strip()
