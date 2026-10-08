import { NextResponse } from "next/server";
import { documentView } from "@/lib/db";

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