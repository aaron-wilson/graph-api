import OpenAI from "openai";
import { boundedStream, normalizeStreamError, streamWatchdog } from "./http.js";
import { ProviderError, promptSchema, type LlmProvider } from "./port.js";

export function createOpenAiLlm(options: {
  apiKey: string;
  model: string;
  baseURL?: string | undefined;
  timeoutMs: number;
  deadlineMs: number;
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
      async function* source() {
        const watchdog = streamWatchdog(options.timeoutMs, options.deadlineMs, signal);
        try {
          const stream = await client.responses.create(
            {
              model: options.model,
              input: promptSchema.parse(prompt),
              stream: true,
              max_output_tokens: 512,
            },
            { signal: watchdog.signal }
          );
          for await (const event of stream) {
            watchdog.touch();
            if (event.type === "response.output_text.delta") yield event.delta;
            if (event.type === "error") throw new Error("Provider stream error");
          }
          // The SDK ends its iterator quietly on abort; surface it as a timeout or cancellation.
          if (watchdog.signal.aborted) throw new Error("Provider stream aborted");
        } catch (error) {
          throw watchdog.expired
            ? new ProviderError("timeout")
            : normalizeStreamError(error, signal);
        } finally {
          watchdog.dispose();
        }
      }
      yield* boundedStream(source(), signal);
    },
  };
}
