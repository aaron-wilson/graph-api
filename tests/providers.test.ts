import { expect, it, vi } from "vitest";
import { parseEnv } from "../src/config/env.js";
import { createProviders } from "../src/providers/index.js";
import { getJson, boundedStream } from "../src/providers/http.js";
import { mockProviders } from "../src/providers/mock.js";
import { ProviderError } from "../src/providers/port.js";
import { createWttrWeather } from "../src/providers/wttr.js";
import { createOverpassPlaces } from "../src/providers/overpass.js";
import { createTicketmasterEvents } from "../src/providers/ticketmaster.js";
import { createOpenAiLlm } from "../src/providers/openai.js";
import { createAnthropicLlm } from "../src/providers/anthropic.js";
import { z } from "zod";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const transport = (fetcher: typeof fetch) => ({ fetch: fetcher, timeoutMs: 100 });
const collect = async (stream: AsyncIterable<string>) => {
  let result = "";
  for await (const chunk of stream) result += chunk;
  return result;
};

it("keeps all mock capabilities deterministic and selects mixed adapters", async () => {
  expect(await mockProviders.weather.current("Rome")).toBe(
    await mockProviders.weather.current("Rome")
  );
  expect(await mockProviders.places.find("Rome")).toEqual(await mockProviders.places.find("Rome"));
  expect(await mockProviders.events.find("Rome")).toEqual(await mockProviders.events.find("Rome"));
  expect(await collect(mockProviders.llm.stream("Rome"))).toBe(
    await collect(mockProviders.llm.stream("Rome"))
  );
  const fetcher = vi.fn(async () =>
    json({ current_condition: [{ weatherDesc: [{ value: "Sunny" }] }] })
  ) as typeof fetch;
  const mixed = createProviders(parseEnv({ PROVIDER_WEATHER: "wttr" }), fetcher);
  expect(await mixed.weather.current("Rome")).toBe("Sunny");
  expect(await mixed.places.find("Rome")).toEqual(await mockProviders.places.find("Rome"));
  expect(() => parseEnv({ PROVIDER_EVENTS: "ticketmaster" })).toThrow("TICKETMASTER_API_KEY");
  expect(() => parseEnv({ PROVIDER_LLM: "openai" })).toThrow("OPENAI_API_KEY");
  expect(() => parseEnv({ PROVIDER_LLM: "anthropic" })).toThrow("ANTHROPIC_API_KEY");
});

it("validates weather, places and events through injected HTTP transports", async () => {
  const wttrFetch = vi.fn(async (url: string) => {
    expect(url).toContain("New%20York");
    return json({ current_condition: [{ weatherDesc: [{ value: "Clear" }] }] });
  }) as typeof fetch;
  expect(
    await createWttrWeather("https://wttr.test", transport(wttrFetch)).current("New York")
  ).toBe("Clear");
  const overpassFetch = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(String(init?.body)).toContain("New+York");
    return json({ elements: [{ tags: { name: "City Museum", tourism: "attraction" } }] });
  }) as typeof fetch;
  expect(
    await createOverpassPlaces("https://overpass.test", transport(overpassFetch)).find("New York")
  ).toEqual([{ name: "City Museum", category: "attraction" }]);
  const ticketFetch = vi.fn(async (url: string) => {
    expect(url).toContain("apikey=local-key");
    return json({
      _embedded: { events: [{ name: "Concert", dates: { start: { localDate: "2026-10-02" } } }] },
    });
  }) as typeof fetch;
  expect(
    await createTicketmasterEvents(
      "https://ticket.test/events",
      "local-key",
      transport(ticketFetch)
    ).find("Rome")
  ).toEqual([{ name: "Concert", date: "2026-10-02" }]);
  const malformed = createTicketmasterEvents(
    "https://ticket.test/events",
    "local-key",
    transport(async () =>
      json({ _embedded: { events: [{ name: "Bad", dates: { start: { localDate: "wrong" } } }] } })
    )
  );
  await expect(malformed.find("Rome")).rejects.toMatchObject({ code: "invalid_response" });
  await expect(
    createWttrWeather(
      "https://wttr.test",
      transport(async () => json({ bad: true }))
    ).current("Rome")
  ).rejects.toMatchObject({ code: "invalid_response" });
});

it("bounds retries, timeouts, cancellation and response size", async () => {
  const rateFetch = vi.fn(async () => json({}, 429)) as typeof fetch;
  await expect(getJson(transport(rateFetch), "https://test", z.object({}))).rejects.toMatchObject({
    code: "rate_limit",
  });
  expect(rateFetch).toHaveBeenCalledTimes(3);
  const timeoutFetch = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
      )
  ) as typeof fetch;
  await expect(
    getJson(transport(timeoutFetch), "https://test", z.object({}))
  ).rejects.toMatchObject({ code: "timeout" });
  const controller = new AbortController();
  controller.abort();
  await expect(
    getJson(transport(timeoutFetch), "https://test", z.object({}), {}, controller.signal)
  ).rejects.toMatchObject({ code: "cancelled" });
  const large = async function* () {
    yield "x".repeat(4001);
  };
  await expect(collect(boundedStream(large()))).rejects.toMatchObject({ code: "output_limit" });
  await expect(collect(mockProviders.llm.stream("Rome", controller.signal))).rejects.toBeInstanceOf(
    ProviderError
  );
});

it("streams OpenAI and Anthropic SDK events through injected fetch", async () => {
  const openaiFetch = vi.fn(
    async () =>
      new Response(
        'data: {"type":"response.output_text.delta","delta":"Hello"}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } }
      )
  ) as typeof fetch;
  const openai = createOpenAiLlm({
    apiKey: "local",
    model: "test",
    baseURL: "https://openai.test/v1",
    timeoutMs: 1000,
    fetch: openaiFetch,
  });
  expect(await collect(openai.stream("Rome"))).toBe("Hello");
  const anthropicFetch = vi.fn(
    async () =>
      new Response(
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
        { headers: { "content-type": "text/event-stream" } }
      )
  ) as typeof fetch;
  const anthropic = createAnthropicLlm({
    apiKey: "local",
    model: "test",
    baseURL: "https://anthropic.test",
    timeoutMs: 1000,
    fetch: anthropicFetch,
  });
  expect(await collect(anthropic.stream("Rome"))).toBe("Hello");
  const controller = new AbortController();
  const iterator = openai.stream("Rome", controller.signal)[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toBe("Hello");
  controller.abort();
  await expect(iterator.next()).rejects.toMatchObject({ code: "cancelled" });
  const rateFetch = vi.fn(async () => new Response("busy", { status: 429 })) as typeof fetch;
  const limited = createOpenAiLlm({
    apiKey: "local",
    model: "test",
    baseURL: "https://openai.test/v1",
    timeoutMs: 1000,
    fetch: rateFetch,
  });
  await expect(collect(limited.stream("Rome"))).rejects.toMatchObject({ code: "rate_limit" });
  const emptyFetch = vi.fn(
    async () =>
      new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  ) as typeof fetch;
  const empty = createAnthropicLlm({
    apiKey: "local",
    model: "test",
    baseURL: "https://anthropic.test",
    timeoutMs: 1000,
    fetch: emptyFetch,
  });
  await expect(collect(empty.stream("Rome"))).rejects.toMatchObject({ code: "invalid_response" });
});
