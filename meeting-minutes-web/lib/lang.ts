export type LangInfo = { code: "en" | "el" | "mixed"; label: string; flag: string };

export function detectLanguage(text: string): LangInfo {
  const greek = (text.match(/[Ͱ-Ͽ]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const total = greek + latin || 1;
  const greekRatio = greek / total;
  if (greekRatio > 0.7) return { code: "el", label: "Greek", flag: "🇬🇷" };
  if (greekRatio < 0.1) return { code: "en", label: "English", flag: "🇬🇧" };
  return { code: "mixed", label: "Greek / English mixed", flag: "🌐" };
}
