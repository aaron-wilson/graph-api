import OpenAI from "openai";
import { boundedStream, normalizeStreamError } from "./http.js";
import { promptSchema, type LlmProvider } from "./port.js";

export function createOpenAiLlm(options: {
  apiKey: string;
  model: string;
  baseURL?: string | undefined;
  timeoutMs: number;
  fetch?: typeof fetch;
}): LlmProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    timeout: options.timeoutMs,
    maxRetries: 0,
    fetch: options.fetch,
  });
  return {
    async *stream(prompt, signal) {
      const combined = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)])
        : AbortSignal.timeout(options.timeoutMs);
      async function* source() {
        try {
          const stream = await client.responses.create(
            {
              model: options.model,
              input: promptSchema.parse(prompt),
              stream: true,
              max_output_tokens: 512,
            },
            { signal: combined }
          );
          for await (const event of stream) {
            if (event.type === "response.output_text.delta") yield event.delta;
            if (event.type === "error") throw new Error("Provider stream error");
          }
        } catch (error) {
          throw normalizeStreamError(error, signal);
        }
      }
      yield* boundedStream(source(), combined);
    },
  };
}
