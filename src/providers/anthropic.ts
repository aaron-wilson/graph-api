import Anthropic from "@anthropic-ai/sdk";
import { boundedStream, normalizeStreamError, streamWatchdog } from "./http.js";
import { ProviderError, promptSchema, type LlmProvider } from "./port.js";

export function createAnthropicLlm(options: {
  apiKey: string;
  model: string;
  baseURL?: string | undefined;
  timeoutMs: number;
  deadlineMs: number;
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
      async function* source() {
        const watchdog = streamWatchdog(options.timeoutMs, options.deadlineMs, signal);
        try {
          const stream = await client.messages.create(
            {
              model: options.model,
              max_tokens: 512,
              messages: [{ role: "user", content: promptSchema.parse(prompt) }],
              stream: true,
            },
            { signal: watchdog.signal }
          );
          for await (const event of stream) {
            watchdog.touch();
            if (event.type === "content_block_delta" && event.delta.type === "text_delta")
              yield event.delta.text;
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
