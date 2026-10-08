import { createServer } from "node:http";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  createRegistry,
  Harness,
  watchEvents,
  type AgentEvent,
  type ConversationId,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createGatewayModels, CHAT_MODEL } from "./gateway";
import { RenderedDoc, Tafseer } from "./tools";

const PORT = Number(process.env.AGENT_SERVER_PORT ?? 3101);
const DB_FILE = process.env.AGENT_SQLITE ?? "./agent.sqlite";

// Main

async function main() {
  const registry = createRegistry();
  registry.install(Tafseer);

  const harness = await Harness.open(
    await openNodeSqliteStorage(DB_FILE),
    { models: createGatewayModels(), registry },
    BACKGROUND_CONTEXT,
  );
  harness.resume();
  console.log(`harness open over ${DB_FILE} (model: gateway/${CHAT_MODEL})`);

  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200).end("ok");
      return;
    }
    if (req.method === "POST" && req.url === "/ask") {
      handleAsk(harness, req, res).catch((err) => {
        console.error(err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(PORT, () => console.log(`agent server on :${PORT}`));
}

async function handleAsk(
  harness: Harness,
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) {
  const body = (await readBody(req)) as { conversationId?: string; query?: string };
  const query = (body.query ?? "").trim();
  if (!query) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "query required" }));
    return;
  }

  const ctx = BACKGROUND_CONTEXT;
  const conversation =
    (body.conversationId ? await findConversation(harness, body.conversationId, ctx) : undefined) ??
    (await harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: { model: { provider: "gateway", modelId: CHAT_MODEL } } },
      ctx,
    ));

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("session", { conversationId: conversation.id });

  const stream = await watchEvents(harness, conversation.id, ctx);
  res.on("close", () => void stream.stop());

  const submission = await conversation.submit({ type: "input", content: query }, ctx);
  stream.start(async (events) => {
    for (const event of events) await mapEvent(event, harness, conversation.id, send, ctx);
  });

  // The settle commit carries the final events; give the stream a moment to
  // deliver that last batch before closing.
  const settled = await submission.wait(ctx);
  if (settled.status === "unanswered") {
    send("error", { message: settled.reason ?? "The agent could not answer." });
  }
  await sleep(300);
  send("done", {});
  res.end();
}

// Helpers

/** Client ids are strings; durable conversation ids are branded numbers. */
async function findConversation(harness: Harness, id: string, ctx: Context) {
  const numeric = Number(id);
  if (!Number.isInteger(numeric)) return undefined;
  return harness.conversation(numeric as ConversationId, ctx);
}

async function mapEvent(
  event: AgentEvent,
  harness: Harness,
  conversationId: ConversationId,
  send: (event: string, data: unknown) => void,
  ctx: Context,
): Promise<void> {
  switch (event.type) {
    case "message_update":
      for (const change of event.changes) {
        if (change.type === "text_delta") send("delta", { text: change.delta });
      }
      return;
    case "tool_execution_start":
      send("tool", { name: event.toolName, args: event.args });
      return;
    case "tool_execution_end":
      if (event.toolName === "render_results") {
        const state = await harness.documentState(RenderedDoc, conversationId, ctx);
        const doc = state?.value?.doc ?? null;
        if (doc) send("doc", { doc, refine: false });
      }
      return;
    case "task_failed":
      send("error", { message: event.message });
      return;
  }
}

function readBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});