import { NextResponse } from "next/server";
import { surahView } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;
  const view = await surahView(Number(number));
  if (!view) return NextResponse.json({ error: "surah not found" }, { status: 404 });
  return NextResponse.json(view);
}