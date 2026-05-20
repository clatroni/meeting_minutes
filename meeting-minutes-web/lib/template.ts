export type SectionKey =
  | "executive_summary"
  | "discussion_topics"
  | "decisions_log"
  | "action_items"
  | "risks_issues"
  | "timeline"
  | "open_questions";

export type SectionConfig = { key: SectionKey; title: string; enabled: boolean };

export const DEFAULT_TEMPLATE: SectionConfig[] = [
  { key: "executive_summary", title: "Executive summary", enabled: true },
  { key: "discussion_topics", title: "Topics discussed", enabled: true },
  { key: "decisions_log", title: "Decisions", enabled: true },
  { key: "action_items", title: "Action items", enabled: true },
  { key: "risks_issues", title: "Risks & issues", enabled: true },
  { key: "timeline", title: "Timeline", enabled: true },
  { key: "open_questions", title: "Open questions", enabled: true },
];

const STORAGE_KEY = "teams-to-mom.template.v1";

export function loadTemplate(): SectionConfig[] {
  if (typeof window === "undefined") return DEFAULT_TEMPLATE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TEMPLATE;
    const parsed = JSON.parse(raw) as SectionConfig[];
    // Re-align with defaults: drop unknown keys, append any missing keys
    const known = new Set(DEFAULT_TEMPLATE.map(s => s.key));
    const cleaned = parsed.filter(s => known.has(s.key));
    const missing = DEFAULT_TEMPLATE.filter(d => !cleaned.find(s => s.key === d.key));
    return [...cleaned, ...missing];
  } catch {
    return DEFAULT_TEMPLATE;
  }
}

export function saveTemplate(t: SectionConfig[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

export function resetTemplate(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function titleFor(template: SectionConfig[], key: SectionKey): string {
  return template.find(s => s.key === key)?.title || DEFAULT_TEMPLATE.find(s => s.key === key)!.title;
}

export function isEnabled(template: SectionConfig[], key: SectionKey): boolean {
  return template.find(s => s.key === key)?.enabled ?? true;
}
