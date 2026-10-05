import { NextResponse } from "next/server";
import { juzView } from "@/lib/juz";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;
  const view = await juzView(Number(number));
  if (!view) return NextResponse.json({ error: "juz not found" }, { status: 404 });
  return NextResponse.json(view);
}