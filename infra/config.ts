import { z } from "zod";
const schema = z.object({
  PLATFORM_ACCOUNT: z.string().regex(/^\d{12}$/),
  PLATFORM_REGION: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
  PLATFORM_ENV: z.string().regex(/^[a-z][a-z0-9-]{0,14}$/),
  PLATFORM_AVAILABILITY_ZONES: z.string(),
  PLATFORM_SITE_ORIGIN: z.string().url(),
  API_IMAGE_TAG: z.string().regex(/^[a-f0-9]{40}$/),
  API_LLM_PROVIDER: z.enum(["mock", "openai", "anthropic"]).default("mock"),
  API_LLM_MODEL: z.string().min(1).optional(),
  API_EVENTS_PROVIDER: z.enum(["mock", "ticketmaster"]).default("mock"),
});
export function parseConfig(input: Record<string, string | undefined>) {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      `Invalid deployment input: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`
    );
  const c = result.data;
  const zones = c.PLATFORM_AVAILABILITY_ZONES.split(",");
  if (
    zones.length !== 2 ||
    new Set(zones).size !== 2 ||
    zones.some((zone) => !new RegExp(`^${c.PLATFORM_REGION}[a-z]$`).test(zone))
  )
    throw new Error("Invalid deployment input: PLATFORM_AVAILABILITY_ZONES");
  const origin = new URL(c.PLATFORM_SITE_ORIGIN);
  if (origin.protocol !== "https:" || origin.origin !== c.PLATFORM_SITE_ORIGIN)
    throw new Error("Invalid deployment input: PLATFORM_SITE_ORIGIN");
  if (c.API_LLM_PROVIDER !== "mock" && !c.API_LLM_MODEL)
    throw new Error("Invalid deployment input: API_LLM_MODEL");
  return Object.freeze(c);
}
export type ApiConfig = ReturnType<typeof parseConfig>;
