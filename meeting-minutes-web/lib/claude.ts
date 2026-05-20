import Anthropic from "@anthropic-ai/sdk";
import { MOM_RULES } from "./rules";
import type { MoM } from "./types";

export type Tone = "executive" | "detailed" | "casual";

const TONE_PRESETS: Record<Tone, string> = {
  executive:
    "\n=== TONE ===\nExecutive mode. Keep the executive summary to 4 sentences. Use 3–5 short topic bullets. " +
    "Action descriptions should be verb-led, under 18 words.\n=== END TONE ===\n",
  detailed:
    "\n=== TONE ===\nDetailed mode. Executive summary 8–12 sentences with full context. Use 5–8 topic bullets, each " +
    "with a 2–4 sentence summary. Capture nuance and rationale.\n=== END TONE ===\n",
  casual:
    "\n=== TONE ===\nInternal/casual mode. Slightly less formal, suitable for an internal team channel. Still " +
    "professional — no slang, but friendlier phrasing.\n=== END TONE ===\n",
};

const MOM_SCHEMA = {
  type: "object" as const,
  required: ["meeting_info", "executive_summary", "discussion_topics", "action_items", "decisions_log"],
  properties: {
    meeting_info: {
      type: "object",
      required: ["title", "date", "participants"],
      properties: {
        project_name: { type: "string" },
        client_name: { type: "string" },
        title: { type: "string" },
        date: { type: "string" },
        duration: { type: "string" },
        objective: { type: "string" },
        language: { type: "string" },
        participants: {
          type: "array",
          items: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              organization: { type: "string" },
            },
          },
        },
      },
    },
    executive_summary: { type: "string" },
    discussion_topics: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "summary"],
        properties: { title: { type: "string" }, summary: { type: "string" } },
      },
    },
    decisions_log: {
      type: "array",
      items: {
        type: "object",
        required: ["decision"],
        properties: {
          decision: { type: "string" },
          rationale: { type: "string" },
          owner: { type: "string" },
        },
      },
    },
    action_items: {
      type: "array",
      items: {
        type: "object",
        required: ["action", "owner", "priority", "status"],
        properties: {
          action: { type: "string" },
          owner: { type: "string" },
          due_date: { type: "string" },
          priority: { type: "string", enum: ["High", "Medium", "Low"] },
          status: { type: "string", enum: ["Not Started", "In Progress", "Completed"] },
        },
      },
    },
    risks_issues: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "description", "impact"],
        properties: {
          type: { type: "string", enum: ["Risk", "Issue"] },
          description: { type: "string" },
          impact: { type: "string", enum: ["High", "Medium", "Low"] },
          owner: { type: "string" },
        },
      },
    },
    timeline: {
      type: "array",
      items: {
        type: "object",
        required: ["milestone", "date"],
        properties: { milestone: { type: "string" }, date: { type: "string" } },
      },
    },
    open_questions: { type: "array", items: { type: "string" } },
  },
};

function extractSystem(tone: Tone) {
  return `You are an expert Project Manager, PMO Lead, and Consulting Delivery Manager. You convert Microsoft Teams meeting transcripts into structured, executive-grade Meeting Minutes (MoMs) for senior stakeholders.

Your output MUST follow these rules:

=== TEAM RULES ===
${MOM_RULES}
=== END TEAM RULES ===
${TONE_PRESETS[tone]}
Submit your output via the \`submit_minutes\` tool. Fill every relevant field. Use empty arrays only when truly nothing applies.`;
}

const REVIEW_SYSTEM = (tone: Tone) => `You are a senior PMO quality reviewer auditing draft Meeting Minutes.
You are given:
  1) The cleaned meeting transcript
  2) A first-pass extraction in JSON

Your job: return a CORRECTED full JSON with the SAME schema. Apply the audit below, in order.

=== TEAM RULES (must be respected) ===
${MOM_RULES}
=== END TEAM RULES ===
${TONE_PRESETS[tone]}
=== AUDIT STEPS ===

STEP 1 — ACTION ITEMS (highest priority)
- Future markers ("will", "I'll", "θα", "να", imperative) and no past completion verb → status "Not Started" / "In Progress", NEVER "Completed".
- "Completed" requires explicit past-tense ("done", "sent", "ολοκλήρωσα", "έστειλα"). If in doubt → "Not Started".
- Patterns the first pass often misses — add them as actions:
  • Command + acceptance: "Send me the file" + "OK" → action on the OK-sayer.
  • Volunteer + confirmation: "Should I do it?" + "Yes" → action on the volunteer.
  • Personal commitment: "I'll look at it", "θα το κοιτάξω" → action on the speaker.
  • Direct assignment by name: "Kosta, do X" → action on Kostas.
- Owners must be FULL names matching the participants list. Unknown → "TBD".

STEP 2 — DECISIONS
- Only agreed decisions, not discussions.
- Strip pleasantry prefixes ("OK,", "Agreed,", "Συμφωνώ,") — keep the substance only.

STEP 3 — EXECUTIVE SUMMARY
- Order: situation → key decisions → risks → next milestone.
- NEVER meta-narration ("5 attendees made 73 contributions"). Strip such phrasing.

STEP 4 — TOPICS
- Cover what was discussed AND concluded. Merge duplicates. Remove pleasantries-only topics.

STEP 5 — RISKS & ISSUES
- Risk = future threat; Issue = current problem. Only Amber/Red items.
- Don't duplicate items already in action_items.

STEP 6 — NORMALIZATION
- Empty strings, "N/A", "—" forbidden → "TBD" or omit.
- Enums must match exactly: priority ∈ {High, Medium, Low}, status ∈ {Not Started, In Progress, Completed}, risk type ∈ {Risk, Issue}.
- Actions: verb-led, under 18 words, no filler.

OUTPUT
Submit the CORRECTED minutes via the \`submit_minutes\` tool. Return the FULL JSON, not just the diff.`;

export async function extractMinutes(
  transcript: string,
  { tone = "executive", review = false, language }: { tone?: Tone; review?: boolean; language?: string } = {}
): Promise<MoM> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set in the environment");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  // First pass — extraction
  const resp = await client.messages.create({
    model,
    max_tokens: 8000,
    temperature: 0.2,
    system: extractSystem(tone),
    tools: [{
      name: "submit_minutes",
      description: "Submit the structured Meeting Minutes.",
      input_schema: MOM_SCHEMA,
    }],
    tool_choice: { type: "tool", name: "submit_minutes" },
    messages: [{
      role: "user",
      content:
        (language ? `Detected primary language: **${language}**. Write ALL output in this language (titles, summaries, topics, decisions, actions, risks, questions).\n\n` : "") +
        `=== TRANSCRIPT ===\n${transcript}\n=== END TRANSCRIPT ===`,
    }],
  });

  let mom: MoM | null = null;
  for (const block of resp.content) {
    if (block.type === "tool_use" && block.name === "submit_minutes") {
      mom = block.input as MoM;
      break;
    }
  }
  if (!mom) throw new Error("Claude did not return an extraction");

  if (!review) return mom;

  // Second pass — review/audit
  try {
    const reviewResp = await client.messages.create({
      model,
      max_tokens: 8000,
      temperature: 0,
      system: REVIEW_SYSTEM(tone),
      tools: [{
        name: "submit_minutes",
        description: "Submit the CORRECTED Meeting Minutes after audit.",
        input_schema: MOM_SCHEMA,
      }],
      tool_choice: { type: "tool", name: "submit_minutes" },
      messages: [{
        role: "user",
        content:
          `=== TRANSCRIPT ===\n${transcript}\n=== END TRANSCRIPT ===\n\n` +
          `=== FIRST EXTRACTION (JSON) ===\n${JSON.stringify(mom, null, 2)}\n=== END FIRST EXTRACTION ===`,
      }],
    });
    for (const block of reviewResp.content) {
      if (block.type === "tool_use" && block.name === "submit_minutes") {
        return block.input as MoM;
      }
    }
  } catch {
    // Review failure is non-fatal — return the first extraction unchanged.
  }
  return mom;
}
