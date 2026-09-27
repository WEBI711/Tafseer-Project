import { answer } from "@/lib/agent";
import { search } from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * Agent endpoint. Emits SSE:
 *   event: doc   -> the response document to render in the reader
 *   event: delta -> answer text chunks
 *   event: done  -> end of stream
 *   event: error
 */
export async function POST(req: Request) {
  const { query, surah, juz, refine } = (await req.json()) as {
    query?: string;
    surah?: number;
    juz?: number;
    refine?: boolean;
  };

  const encoder = new TextEncoder();
  const send = (event: string, data: unknown) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!query?.trim()) {
    return new Response(JSON.stringify({ error: "query required" }), { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Retrieval feeds both the rendered document and the agent context.
        const doc = await search(query.trim(), { surah, juz });
        controller.enqueue(send("doc", { doc, refine: Boolean(refine) }));

        const hits = doc.groups.flatMap((g) =>
          g.ayat.flatMap((a) =>
            a.commentary.map((c) => ({
              content: c.content,
              source_file: c.source_file,
              cjuz: g.juz,
              ayah_number: a.number,
              surah_number: g.surah,
              name_en: g.name_en,
              section_title: a.section_title,
              text_ar: a.text_ar,
              translation: a.translation,
              score: c.score,
            })),
          ),
        );

        for await (const delta of answer(query.trim(), hits)) {
          controller.enqueue(send("delta", { text: delta }));
        }
        controller.enqueue(send("done", {}));
      } catch (err) {
        controller.enqueue(
          send("error", { message: err instanceof Error ? err.message : String(err) }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}