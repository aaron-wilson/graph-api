import Anthropic from "@anthropic-ai/sdk";
import { boundedStream, normalizeStreamError } from "./http.js";
import { promptSchema, type LlmProvider } from "./port.js";

export function createAnthropicLlm(options: {
  apiKey: string;
  model: string;
  baseURL?: string | undefined;
  timeoutMs: number;
  fetch?: typeof fetch;
}): LlmProvider {
  const client = new Anthropic({
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
          const stream = await client.messages.create(
            {
              model: options.model,
              max_tokens: 512,
              messages: [{ role: "user", content: promptSchema.parse(prompt) }],
              stream: true,
            },
            { signal: combined }
          );
          for await (const event of stream)
            if (event.type === "content_block_delta" && event.delta.type === "text_delta")
              yield event.delta.text;
        } catch (error) {
          throw normalizeStreamError(error, signal);
        }
      }
      yield* boundedStream(source(), combined);
    },
  };
}
