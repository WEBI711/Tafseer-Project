import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await query<Record<string, any>>(
    `SELECT number, arabic_header FROM juz ORDER BY number`,
  );
  return NextResponse.json(rows);
}