import type { z } from "zod";
import { ProviderError } from "./port.js";

export interface HttpTransport {
  fetch: typeof fetch;
  timeoutMs: number;
}
function classify(error: unknown, signal?: AbortSignal): ProviderError {
  if (error instanceof ProviderError) return error;
  if (signal?.aborted) return new ProviderError("cancelled");
  if (typeof error === "object" && error !== null && "status" in error && error.status === 429)
    return new ProviderError("rate_limit");
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
    return new ProviderError("timeout");
  return new ProviderError("unavailable");
}
async function boundedText(response: Response, maxBytes = 200_000) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new ProviderError("invalid_response");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
export async function getJson<T extends z.ZodTypeAny>(
  transport: HttpTransport,
  url: string,
  schema: T,
  init: RequestInit = {},
  signal?: AbortSignal
): Promise<z.infer<T>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new ProviderError("cancelled");
    const timeout = AbortSignal.timeout(transport.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await transport.fetch(url, { ...init, signal: combined });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          if (attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 20 * 2 ** attempt + Math.random() * 10)
            );
            continue;
          }
          throw new ProviderError(response.status === 429 ? "rate_limit" : "unavailable");
        }
        throw new ProviderError("unavailable");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await boundedText(response));
      } catch {
        throw new ProviderError("invalid_response");
      }
      const result = schema.safeParse(parsed);
      if (!result.success) throw new ProviderError("invalid_response");
      return result.data;
    } catch (error) {
      const normalized = classify(error, signal);
      if (normalized.code === "timeout" && attempt < 2) continue;
      throw normalized;
    }
  }
  throw new ProviderError("unavailable");
}
export function normalizeStreamError(error: unknown, signal?: AbortSignal): ProviderError {
  return classify(error, signal);
}
export async function* boundedStream(source: AsyncIterable<string>, signal?: AbortSignal) {
  let length = 0;
  try {
    for await (const chunk of source) {
      if (signal?.aborted) throw new ProviderError("cancelled");
      length += chunk.length;
      if (length > 4000) throw new ProviderError("output_limit");
      yield chunk;
    }
    if (signal?.aborted) throw new ProviderError("cancelled");
    if (length === 0) throw new ProviderError("invalid_response");
  } catch (error) {
    throw classify(error, signal);
  }
}
