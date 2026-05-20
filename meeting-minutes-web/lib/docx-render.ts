import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, PageOrientation,
} from "docx";
import type { MoM } from "./types";

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

export async function renderDocx(mom: MoM): Promise<Buffer> {
  const info = mom.meeting_info;
  const children: (Paragraph | Table)[] = [];

  // Title block
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

  // Participants
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

  // Executive summary
  children.push(heading("Executive summary"));
  children.push(body(mom.executive_summary));

  // Topics
  if (mom.discussion_topics?.length) {
    children.push(heading("Topics discussed"));
    for (const t of mom.discussion_topics) {
      children.push(bullet(t.summary, t.title));
    }
  }

  // Decisions
  if (mom.decisions_log?.length) {
    children.push(heading("Decisions"));
    for (const d of mom.decisions_log) {
      const owner = d.owner ? ` (Owner: ${d.owner})` : "";
      const rationale = d.rationale ? ` — ${d.rationale}` : "";
      children.push(bullet(rationale + owner, d.decision));
    }
  }

  // Action items table
  if (mom.action_items?.length) {
    children.push(heading("Action items"));
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
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...rows],
    }));
  }

  // Risks & issues
  if (mom.risks_issues?.length) {
    children.push(heading("Risks & issues"));
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
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...rows],
    }));
  }

  // Timeline
  if (mom.timeline?.length) {
    children.push(heading("Timeline"));
    for (const t of mom.timeline) {
      children.push(bullet(t.date, t.milestone));
    }
  }

  // Open questions
  if (mom.open_questions?.length) {
    children.push(heading("Open questions"));
    for (const q of mom.open_questions) children.push(bullet(q));
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
