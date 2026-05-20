import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, PageOrientation,
} from "docx";
import type { MoM } from "./types";
import { DEFAULT_TEMPLATE, type SectionConfig, type SectionKey } from "./template";

const INK = "0A0A0A";
const GREEN = "86BC25";
const GREEN_D = "3C6500";
const SUBTLE = "53565A";

function heading(text: string) {
  return new Paragraph({
    spacing: { before: 360, after: 120 },
    border: { bottom: { color: GREEN, size: 6, space: 4, style: BorderStyle.SINGLE } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color: INK, size: 22, font: "Calibri" })],
  });
}

function body(text: string, opts: { italic?: boolean; muted?: boolean } = {}) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({
      text, font: "Calibri", size: 22,
      italics: opts.italic, color: opts.muted ? SUBTLE : INK,
    })],
  });
}

function bullet(text: string, bold?: string) {
  const runs: TextRun[] = [];
  if (bold) runs.push(new TextRun({ text: bold + " — ", bold: true, font: "Calibri", size: 22 }));
  runs.push(new TextRun({ text, font: "Calibri", size: 22 }));
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: runs });
}

function tableCell(text: string, opts: { bold?: boolean; bg?: string; color?: string } = {}) {
  return new TableCell({
    shading: opts.bg ? { type: ShadingType.CLEAR, color: "auto", fill: opts.bg } : undefined,
    children: [new Paragraph({
      children: [new TextRun({
        text, font: "Calibri", size: 20, bold: opts.bold,
        color: opts.color || INK,
      })],
    })],
  });
}

function priorityColor(p: string) {
  return p === "High" ? "FEF0F0" : p === "Medium" ? "FEF5E4" : "F5F4F0";
}
function statusColor(s: string) {
  return s === "Completed" ? "EEF7D9" : s === "In Progress" ? "EDF2FF" : "F5F4F0";
}

export async function renderDocx(mom: MoM, template: SectionConfig[] = DEFAULT_TEMPLATE): Promise<Buffer> {
  const info = mom.meeting_info;
  const children: (Paragraph | Table)[] = [];

  // Title block — always shown
  children.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({
      text: info.title || "Meeting Minutes",
      bold: true, color: INK, size: 44, font: "Georgia",
    })],
  }));
  const metaBits = [info.date, info.duration, info.client_name].filter(Boolean).join(" · ");
  if (metaBits) children.push(body(metaBits, { muted: true }));
  if (info.objective) children.push(body(info.objective, { italic: true, muted: true }));

  // Participants — always shown
  if (info.participants?.length) {
    const names = info.participants.map(p => p.role ? `${p.name} (${p.role})` : p.name).join(", ");
    children.push(new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [
        new TextRun({ text: "Participants: ", bold: true, font: "Calibri", size: 22 }),
        new TextRun({ text: names, font: "Calibri", size: 22 }),
      ],
    }));
  }

  // Iterate sections in template order — respects enable/disable + rename
  for (const section of template) {
    if (!section.enabled) continue;
    const key = section.key as SectionKey;
    const title = section.title;

    if (key === "executive_summary" && mom.executive_summary) {
      children.push(heading(title));
      children.push(body(mom.executive_summary));
    } else if (key === "discussion_topics" && mom.discussion_topics?.length) {
      children.push(heading(title));
      for (const t of mom.discussion_topics) children.push(bullet(t.summary, t.title));
    } else if (key === "decisions_log" && mom.decisions_log?.length) {
      children.push(heading(title));
      for (const d of mom.decisions_log) {
        const owner = d.owner ? ` (Owner: ${d.owner})` : "";
        const rationale = d.rationale ? ` — ${d.rationale}` : "";
        children.push(bullet(rationale + owner, d.decision));
      }
    } else if (key === "action_items" && mom.action_items?.length) {
      children.push(heading(title));
      const headerRow = new TableRow({
        tableHeader: true,
        children: ["Action", "Owner", "Due", "Priority", "Status"].map(h =>
          tableCell(h, { bold: true, bg: INK, color: "FFFFFF" })),
      });
      const rows = mom.action_items.map(a => new TableRow({
        children: [
          tableCell(a.action),
          tableCell(a.owner || "TBD"),
          tableCell(a.due_date || "TBD"),
          tableCell(a.priority, { bg: priorityColor(a.priority) }),
          tableCell(a.status, { bg: statusColor(a.status) }),
        ],
      }));
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }));
    } else if (key === "risks_issues" && mom.risks_issues?.length) {
      children.push(heading(title));
      const headerRow = new TableRow({
        tableHeader: true,
        children: ["Type", "Description", "Impact", "Owner"].map(h =>
          tableCell(h, { bold: true, bg: INK, color: "FFFFFF" })),
      });
      const rows = mom.risks_issues.map(r => new TableRow({
        children: [
          tableCell(r.type, { bg: r.type === "Issue" ? "FEF0F0" : "FEF5E4" }),
          tableCell(r.description),
          tableCell(r.impact, { bg: priorityColor(r.impact) }),
          tableCell(r.owner || "TBD"),
        ],
      }));
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }));
    } else if (key === "timeline" && mom.timeline?.length) {
      children.push(heading(title));
      for (const t of mom.timeline) children.push(bullet(t.date, t.milestone));
    } else if (key === "open_questions" && mom.open_questions?.length) {
      children.push(heading(title));
      for (const q of mom.open_questions) children.push(bullet(q));
    }
  }

  // Footer line
  children.push(new Paragraph({
    spacing: { before: 600 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: "Strictly Private & Confidential · Deloitte",
      italics: true, color: SUBTLE, size: 18, font: "Calibri",
    })],
  }));

  const doc = new Document({
    creator: "Teams-to-MoM (Deloitte AI Prompting Lab)",
    title: info.title || "Meeting Minutes",
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.PORTRAIT } } },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}
