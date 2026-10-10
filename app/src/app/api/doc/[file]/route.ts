import { NextResponse } from "next/server";
import { documentView, updateDocBlock } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const view = await documentView(decodeURIComponent(file));
  if (!view) return NextResponse.json({ error: "document not found" }, { status: 404 });
  return NextResponse.json(view);
}

/**
 * One block's text, edited by the designated editor. The server-side
 * EDITOR_TOKEN is the only authority — it never reaches other clients, who
 * simply pick up the new text on their next fetch (this route is dynamic).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const expected = process.env.EDITOR_TOKEN;
  if (!expected || (req.headers.get("x-editor-token") ?? "") !== expected) {
    return NextResponse.json({ error: "not authorized" }, { status: 403 });
  }
  const { file } = await params;
  const body = (await req.json().catch(() => null)) as
    | { ord?: unknown; text?: unknown }
    | null;
  const ord = Number(body?.ord);
  if (!body || !Number.isInteger(ord) || ord < 0 || typeof body?.text !== "string"
    || !body.text.trim()) {
    return NextResponse.json({ error: "ord (number) and non-empty text required" }, { status: 400 });
  }
  const editor = process.env.EDITOR_NAME ?? "designated editor";
  const result = await updateDocBlock(decodeURIComponent(file), ord, body.text, editor);
  if (result === "no-block") {
    return NextResponse.json({ error: "document or block not found" }, { status: 404 });
  }
  if (result === "unavailable") {
    return NextResponse.json({ error: "document storage is not available" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}