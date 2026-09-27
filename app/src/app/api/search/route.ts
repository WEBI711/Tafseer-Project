import { NextResponse } from "next/server";
import { search } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { query, surah, juz } = (await req.json()) as {
    query?: string;
    surah?: number;
    juz?: number;
  };
  if (!query?.trim()) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }
  return NextResponse.json(await search(query.trim(), { surah, juz }));
}