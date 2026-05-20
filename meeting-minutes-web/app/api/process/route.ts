import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { extractMinutes, type Tone } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_TONES: Tone[] = ["executive", "detailed", "casual"];

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let transcript = "";
    let tone: Tone = "executive";
    let review = false;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      const text = formData.get("text");
      const t = formData.get("tone");
      const r = formData.get("review");
      if (typeof t === "string" && VALID_TONES.includes(t as Tone)) tone = t as Tone;
      if (typeof r === "string") review = r === "true" || r === "1";

      if (file instanceof File) {
        const ext = file.name.toLowerCase().split(".").pop();
        const bytes = Buffer.from(await file.arrayBuffer());
        if (ext === "docx") {
          const { value } = await mammoth.extractRawText({ buffer: bytes });
          transcript = value;
        } else if (ext === "txt") {
          transcript = bytes.toString("utf-8");
        } else {
          return NextResponse.json({ error: `Unsupported file type .${ext}. Use .docx or .txt` }, { status: 400 });
        }
      } else if (typeof text === "string") {
        transcript = text;
      }
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      transcript = body.text || "";
      if (typeof body.tone === "string" && VALID_TONES.includes(body.tone as Tone)) tone = body.tone as Tone;
      if (typeof body.review === "boolean") review = body.review;
    }

    transcript = transcript.trim();
    if (!transcript) {
      return NextResponse.json({ error: "Empty transcript — upload a .docx/.txt file or paste text" }, { status: 400 });
    }

    const mom = await extractMinutes(transcript, { tone, review });
    return NextResponse.json({ mom });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
