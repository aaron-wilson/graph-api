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
import { gatherIdeas } from "../src/trips/planner.js";
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
  await expect(malformed.find("Rome")).resolves.toEqual([]);
  await expect(
    createWttrWeather(
      "https://wttr.test",
      transport(async () => json({ bad: true }))
    ).current("Rome")
  ).rejects.toMatchObject({ code: "invalid_response" });
});

it("filters invalid vendor items after validating collection envelopes", async () => {
  const event = (events: unknown) =>
    createTicketmasterEvents(
      "https://ticket.test/events",
      "local-key",
      transport(async () => json({ _embedded: { events } }))
    );
  const place = (elements: unknown) =>
    createOverpassPlaces(
      "https://overpass.test",
      transport(async () => json({ elements }))
    );
  const validEvent = { name: "E".repeat(121), dates: { start: { localDate: "2026-10-02" } } };
  const invalidEvent = { name: "TBA", dates: { start: { dateTBA: true } } };
  expect(await event([invalidEvent, validEvent]).find("Rome")).toEqual([
    { name: "E".repeat(120), date: "2026-10-02" },
  ]);
  expect(await event([...Array(10).fill(invalidEvent), validEvent]).find("Rome")).toHaveLength(1);
  expect(await event([invalidEvent]).find("Rome")).toEqual([]);
  await expect(event({ bad: true }).find("Rome")).rejects.toMatchObject({
    code: "invalid_response",
  });
  const validPlace = { tags: { name: "P".repeat(121), tourism: "attraction" } };
  expect(await place([{ tags: { name: "  ", tourism: "bad" } }, validPlace]).find("Rome")).toEqual([
    { name: "P".repeat(120), category: "attraction" },
  ]);
  expect(await place([...Array(10).fill({}), validPlace]).find("Rome")).toHaveLength(1);
  expect(await place([{ tags: { name: "  " } }]).find("Rome")).toEqual([]);
  await expect(place({ bad: true }).find("Rome")).rejects.toMatchObject({
    code: "invalid_response",
  });
});

it("retries body-read timeouts and preserves caller cancellation", async () => {
  const responses: Response[] = [];
  const stalled = (_url: string, init?: RequestInit) => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
      })
    );
    responses.push(response);
    return response;
  };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
    fetcher.mock.calls.length === 1 ? stalled(url, init) : json({ ok: true })
  ) as typeof fetch;
  await expect(
    getJson({ fetch: fetcher, timeoutMs: 20 }, "https://test", z.object({ ok: z.boolean() }))
  ).resolves.toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(2);
  const exhausted = vi.fn(stalled) as typeof fetch;
  await expect(
    getJson({ fetch: exhausted, timeoutMs: 20 }, "https://test", z.object({}))
  ).rejects.toMatchObject({ code: "timeout" });
  expect(exhausted).toHaveBeenCalledTimes(3);
  const controller = new AbortController();
  const pending = getJson(
    { fetch: stalled as typeof fetch, timeoutMs: 1000 },
    "https://test",
    z.object({}),
    {},
    controller.signal
  );
  setTimeout(() => controller.abort(), 5);
  await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  expect(responses.every((response) => response.body?.locked === false)).toBe(true);
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
    deadlineMs: 5000,
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
    deadlineMs: 5000,
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
    deadlineMs: 5000,
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
    deadlineMs: 5000,
    fetch: emptyFetch,
  });
  await expect(collect(empty.stream("Rome"))).rejects.toMatchObject({ code: "invalid_response" });
});

it("bounds LLM streams by first-token, idle and total deadlines", async () => {
  // Emits `count` frames every `everyMs`, then `end`; a negative count never ends.
  const paced =
    (frame: (index: number) => string, end: string, count: number, everyMs: number): typeof fetch =>
    async (_input, init) => {
      const encoder = new TextEncoder();
      let sent = 0;
      let timer: ReturnType<typeof setInterval> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          timer = setInterval(() => {
            if (count < 0 || sent < count) controller.enqueue(encoder.encode(frame((sent += 1))));
            else {
              clearInterval(timer);
              controller.enqueue(encoder.encode(end));
              controller.close();
            }
          }, everyMs);
          init?.signal?.addEventListener("abort", () => {
            clearInterval(timer);
            controller.error(init.signal?.reason);
          });
        },
        cancel: () => clearInterval(timer),
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
  const vendors = [
    (fetcher: typeof fetch, deadlineMs = 2000) =>
      createOpenAiLlm({
        apiKey: "local",
        model: "test",
        baseURL: "https://openai.test/v1",
        timeoutMs: 150,
        deadlineMs,
        fetch: fetcher,
      }),
    (fetcher: typeof fetch, deadlineMs = 2000) =>
      createAnthropicLlm({
        apiKey: "local",
        model: "test",
        baseURL: "https://anthropic.test",
        timeoutMs: 150,
        deadlineMs,
        fetch: fetcher,
      }),
  ];
  const frames = [
    [
      (index: number) => `data: {"type":"response.output_text.delta","delta":"w${index} "}\n\n`,
      "data: [DONE]\n\n",
    ],
    [
      (index: number) =>
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"w${index} "}}\n\n`,
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ],
  ] as const;
  for (const [index, create] of vendors.entries()) {
    const [frame, end] = frames[index] ?? frames[0];
    // Twelve chunks 40 ms apart outlast the 150 ms step timeout but never stall.
    const steady = await collect(create(paced(frame, end, 12, 40)).stream("Rome"));
    expect(steady.trim().split(" ")).toHaveLength(12);
    await expect(collect(create(paced(frame, end, 1, 400)).stream("Rome"))).rejects.toMatchObject({
      code: "timeout",
    });
    await expect(
      collect(create(paced(frame, end, -1, 40), 400).stream("Rome"))
    ).rejects.toMatchObject({ code: "timeout" });
    const controller = new AbortController();
    const iterator = create(paced(frame, end, -1, 40))
      .stream("Rome", controller.signal)
      [Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe("w1 ");
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: "cancelled" });
  }
});

it("fails a selected provider clearly instead of answering from a mock", async () => {
  const key = "PRIVATE_VENDOR_KEY";
  const selected = (fetcher: typeof fetch) =>
    createProviders(
      parseEnv({
        PROVIDER_WEATHER: "wttr",
        PROVIDER_PLACES: "overpass",
        PROVIDER_EVENTS: "ticketmaster",
        TICKETMASTER_API_KEY: key,
        PROVIDER_TIMEOUT_MS: "100",
      }),
      fetcher
    );
  const outcome = async (work: Promise<unknown>) => {
    try {
      await work;
      return { code: "resolved", text: "" };
    } catch (error) {
      return {
        code: error instanceof ProviderError ? error.code : "other",
        text: `${String(error)} ${JSON.stringify(error)}`,
      };
    }
  };
  const failures: [string, typeof fetch, string][] = [
    ["authentication", vi.fn(async () => json({ fault: key }, 401)) as typeof fetch, "unavailable"],
    ["forbidden", vi.fn(async () => json({ fault: key }, 403)) as typeof fetch, "unavailable"],
    [
      "invalid payload",
      vi.fn(async () => json({ unexpected: key })) as typeof fetch,
      "invalid_response",
    ],
    [
      "not json",
      vi.fn(async () => new Response(`<html>${key}</html>`, { status: 200 })) as typeof fetch,
      "invalid_response",
    ],
    [
      "timeout",
      vi.fn(
        async (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
          )
      ) as typeof fetch,
      "timeout",
    ],
  ];
  for (const [name, fetcher, code] of failures) {
    const providers = selected(fetcher);
    for (const [capability, work] of [
      ["weather", providers.weather.current("Rome")],
      ["events", providers.events.find("Rome")],
    ] as const) {
      const result = await outcome(work);
      // An events envelope with no events is valid, so a stray payload yields an empty list.
      if (name === "invalid payload" && capability === "events") {
        expect(result.code, `${name} ${capability}`).toBe("resolved");
        continue;
      }
      expect(result.code, `${name} ${capability}`).toBe(code);
      expect(result.text, `${name} ${capability}`).not.toContain(key);
    }
    expect(fetcher).toHaveBeenCalled();
    // The planner surfaces the same failure; no mock idea is substituted.
    const ideas = await outcome(gatherIdeas(selected(fetcher), "Rome", ["food"]));
    if (name !== "invalid payload") expect(ideas.code, name).toBe(code);
    expect(ideas.text).not.toContain(key);
  }
});
