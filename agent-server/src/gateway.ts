import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Models,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export const CHAT_MODEL = process.env.TAFSEER_CHAT_MODEL ?? "glm-5.3-flash";

const BASE_URL = process.env.TAFSEER_LLM_BASE ?? "https://openrouter.ai/api/v1";

/** One OpenAI-compatible provider pointed at our gateway (OpenRouter by default). */
export function createGatewayModels(): Models {
  const models = createModels();
  models.setProvider(
    createProvider({
      id: "gateway",
      name: "LLM gateway",
      baseUrl: BASE_URL,
      auth: { apiKey: envApiKeyAuth("LLM API key", ["TAFSEER_LLM_KEY", "OPENROUTER_API_KEY"]) },
      models: [
        {
          id: CHAT_MODEL,
          name: CHAT_MODEL,
          api: "openai-completions",
          provider: "gateway",
          baseUrl: BASE_URL,
          input: ["text"],
          reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: Number(process.env.TAFSEER_CONTEXT_WINDOW ?? 131_072),
          maxTokens: Number(process.env.TAFSEER_MAX_TOKENS ?? 8_192),
        },
      ],
      api: openAICompletionsApi(),
    }),
  );
  return models;
}