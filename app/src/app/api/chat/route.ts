import { AGENT_SERVER_URL } from "@/lib/agent-server";

export const dynamic = "force-dynamic";

/**
 * Agent endpoint. Bridges to the pi-durable agent server and relays its SSE:
 *   event: session -> { conversationId } (first event; store it client-side)
 *   event: delta   -> answer text chunks
 *   event: tool    -> a tool started running
 *   event: doc     -> the agent rendered a document for the reader
 *   event: done / error
 */
export async function POST(req: Request) {
  const { query, conversationId } = (await req.json()) as {
    query?: string;
    conversationId?: string;
  };

  if (!query?.trim()) {
    return new Response(JSON.stringify({ error: "query required" }), { status: 400 });
  }

  const upstream = await fetch(`${AGENT_SERVER_URL}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: query.trim(), conversationId }),
  }).catch(() => undefined);

  if (!upstream?.ok || !upstream.body) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ message: "The agent server is unreachable." })}\n\n`,
      { headers: SSE_HEADERS },
    );
  }

  return new Response(upstream.body, { headers: SSE_HEADERS });
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};