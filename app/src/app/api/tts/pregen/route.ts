import { pregenStatus, startPregen, stopPregen } from "@/lib/pregen";

export const dynamic = "force-dynamic";

/** Status of the background pre-generation queue. */
export async function GET() {
  return Response.json(pregenStatus());
}

/** Starts the pre-generation run (no-op while one is already running). */
export async function POST() {
  const started = startPregen();
  return Response.json({ ...pregenStatus(), started });
}

/** Cancels the current run; progress already in the durable cache is kept. */
export async function DELETE() {
  stopPregen();
  return Response.json(pregenStatus());
}
