import { NextRequest, NextResponse } from "next/server";
import { renderDocx } from "@/lib/docx-render";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { mom, template } = await req.json();
    if (!mom?.meeting_info) {
      return NextResponse.json({ error: "Missing or invalid `mom` in request body" }, { status: 400 });
    }
    const buf = await renderDocx(mom, template);
    return new NextResponse(buf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="MoM.docx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown render error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
