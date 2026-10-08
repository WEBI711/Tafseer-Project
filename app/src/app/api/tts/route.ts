import { synthesize } from "@/lib/tts";

export const dynamic = "force-dynamic";

/**
 * Read-aloud endpoint for the dictation bar. Bridges to the TTS engine on the
 * host (localhost only, no API keys, config in env vars) and returns the
 * synthesized audio for one chunk: `{ text, voice, speed }`.
 */
export async function POST(req: Request) {
  const { text, voice, speed } = (await req.json()) as {
    text?: string;
    voice?: string;
    speed?: number;
  };

  if (!text?.trim()) {
    return new Response(JSON.stringify({ error: "text required" }), { status: 400 });
  }

  const audio = await synthesize(
    text.trim(),
    voice?.trim() || "en",
    speed && speed > 0 ? speed : 1,
  );
  if (!audio) {
    return new Response(JSON.stringify({ error: "tts engine unreachable" }), { status: 502 });
  }

  return new Response(audio.bytes, {
    headers: { "Content-Type": audio.contentType, "Cache-Control": "no-store" },
  });
}
