import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";
import { extractMinutes } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let transcript = "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      const text = formData.get("text");
      if (file instanceof File) {
        const ext = file.name.toLowerCase().split(".").pop();
        const bytes = Buffer.from(await file.arrayBuffer());
        if (ext === "docx") {
          const { value } = await mammoth.extractRawText({ buffer: bytes });
          transcript = value;
        } else if (ext === "txt") {
          transcript = bytes.toString("utf-8");
        } else {
          return NextResponse.json(
            { error: `Unsupported file type .${ext}. Use .docx or .txt` },
            { status: 400 }
          );
        }
      } else if (typeof text === "string") {
        transcript = text;
      }
    } else if (contentType.includes("application/json")) {
      const body = await req.json();
      transcript = body.text || "";
    }

    transcript = transcript.trim();
    if (!transcript) {
      return NextResponse.json(
        { error: "Empty transcript — upload a .docx/.txt file or paste text" },
        { status: 400 }
      );
    }

    const mom = await extractMinutes(transcript);
    return NextResponse.json({ mom });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
