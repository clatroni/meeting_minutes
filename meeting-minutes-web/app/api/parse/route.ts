import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file in request" }, { status: 400 });
    }
    const ext = file.name.toLowerCase().split(".").pop();
    const bytes = Buffer.from(await file.arrayBuffer());
    let text = "";
    if (ext === "docx") {
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      text = value;
    } else if (ext === "txt") {
      text = bytes.toString("utf-8");
    } else {
      return NextResponse.json({ error: `Unsupported file type .${ext}. Use .docx or .txt` }, { status: 400 });
    }
    return NextResponse.json({
      text: text.trim(),
      sourceLabel: file.name,
      bytes: bytes.length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Parse failed" }, { status: 500 });
  }
}
