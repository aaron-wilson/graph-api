import type { parseEnv } from "../config/env.js";
import { createAnthropicLlm } from "./anthropic.js";
import { createOpenAiLlm } from "./openai.js";
import { createOverpassPlaces } from "./overpass.js";
import { createTicketmasterEvents } from "./ticketmaster.js";
import { createWttrWeather } from "./wttr.js";
import { mockProviders } from "./mock.js";
import type { PlanningProviders } from "./port.js";

export function createProviders(
  config: ReturnType<typeof parseEnv>,
  transportFetch: typeof fetch = fetch
): PlanningProviders {
  const transport = { fetch: transportFetch, timeoutMs: config.providerTimeoutMs };
  return {
    weather:
      config.providerWeather === "wttr"
        ? createWttrWeather(config.wttrUrl, transport)
        : mockProviders.weather,
    places:
      config.providerPlaces === "overpass"
        ? createOverpassPlaces(config.overpassUrl, transport)
        : mockProviders.places,
    events:
      config.providerEvents === "ticketmaster"
        ? createTicketmasterEvents(
            config.ticketmasterUrl,
            config.ticketmasterApiKey ?? "",
            transport
          )
        : mockProviders.events,
    llm:
      config.providerLlm === "openai"
        ? createOpenAiLlm({
            apiKey: config.openaiApiKey ?? "",
            model: config.openaiModel ?? "",
            baseURL: config.openaiBaseUrl,
            timeoutMs: config.providerTimeoutMs,
            fetch: transportFetch,
          })
        : config.providerLlm === "anthropic"
          ? createAnthropicLlm({
              apiKey: config.anthropicApiKey ?? "",
              model: config.anthropicModel ?? "",
              baseURL: config.anthropicBaseUrl,
              timeoutMs: config.providerTimeoutMs,
              fetch: transportFetch,
            })
          : mockProviders.llm,
  };
}
