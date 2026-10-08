import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Tells the Reader whether an editor is configured, so the inline edit
 * affordance only appears when editing can succeed. The token itself stays
 * server-side; the client proves it per request via the PATCH endpoint.
 */
export async function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.EDITOR_TOKEN) });
}
