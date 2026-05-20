export const MOM_RULES = `
TONE & STYLE
- Executive-grade prose. No filler ("OK", "Got it", "Agreed,").
- Action verbs first. Owners always full name. Dates concrete (YYYY-MM-DD or "by Fri 28 Mar").
- Greek output if transcript is primarily Greek; English otherwise. Mixed → match the majority language.

EXECUTIVE SUMMARY (4–8 sentences)
- Order: situation → key decisions → risks → next milestone.
- No meta-narration ("4 attendees made 73 contributions"). Just the substance.

DISCUSSION TOPICS (3–6)
- Cover what was discussed AND concluded. Not who said what.
- Merge duplicates. No pleasantries-only topics.

DECISIONS
- Only agreed decisions, not discussions.
- Strip leading "OK,", "Agreed,", "Συμφωνώ," — keep only the substance.

ACTION ITEMS
- Strict classification: future-marker words ("will", "I'll", "θα", "να", imperative form) → status "Not Started".
- "Completed" requires explicit past-tense completion ("done", "sent", "ολοκλήρωσα", "έστειλα"). If in doubt → "Not Started".
- Ownership patterns to capture:
  • Command + acceptance ("Send me the file" + "OK") → action on the one who said OK.
  • Volunteer + confirmation ("Should I do it?" + "Yes") → action on the volunteer.
  • Personal commitment ("I'll look at it", "θα το κοιτάξω") → action on the speaker.
  • Direct assignment by name ("Kosta, do X") → action on Kostas.
- Owners use the participant's full name. Unknown → "TBD".
- Priority: High = today/this week/blocking. Medium = 1–2 weeks. Low = best-effort.

RISKS & ISSUES
- Risk = future threat. Issue = current problem.
- Only Amber/Red items (blockers, missing sign-offs, delays, missing resources).
- Don't duplicate items already in action_items.

TIMELINE
- Only concrete milestones with explicit dates.
- Empty array if none mentioned.

OPEN QUESTIONS
- Only TRULY unanswered questions. Skip rhetorical questions and ones already addressed.

NORMALIZATION
- Empty strings, "N/A", "—" are forbidden. Use "TBD" or skip the field.
- Enums must match exactly:
  • priority ∈ {High, Medium, Low}
  • status ∈ {Not Started, In Progress, Completed}
  • risk type ∈ {Risk, Issue}
`.trim();
