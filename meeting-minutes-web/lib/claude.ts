import Anthropic from "@anthropic-ai/sdk";
import { MOM_RULES } from "./rules";
import type { MoM } from "./types";

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

const SYSTEM_PROMPT = `You are an expert Project Manager, PMO Lead, and Consulting Delivery Manager. You convert Microsoft Teams meeting transcripts into structured, executive-grade Meeting Minutes (MoMs) for senior stakeholders.

Your output MUST follow these rules:

=== TEAM RULES ===
${MOM_RULES}
=== END TEAM RULES ===

Submit your output via the \`submit_minutes\` tool. Fill every relevant field. Use empty arrays only when truly nothing applies.`;

export async function extractMinutes(transcript: string): Promise<MoM> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set in the environment");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const resp = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
    max_tokens: 8000,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "submit_minutes",
        description: "Submit the structured Meeting Minutes.",
        input_schema: MOM_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "submit_minutes" },
    messages: [
      {
        role: "user",
        content: `=== TRANSCRIPT ===\n${transcript}\n=== END TRANSCRIPT ===`,
      },
    ],
  });

  for (const block of resp.content) {
    if (block.type === "tool_use" && block.name === "submit_minutes") {
      return block.input as MoM;
    }
  }
  throw new Error("Claude did not return a tool_use block");
}
