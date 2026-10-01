import { z } from "zod";
const blankAsUnset = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
/** A provider selection; a blank or missing value keeps the offline mock. */
const selector = <const T extends [string, ...string[]]>(values: T) =>
  z.preprocess(blankAsUnset, z.enum(values).default(values[0]));
const schema = z.object({
  PLATFORM_ACCOUNT: z.string().regex(/^\d{12}$/),
  PLATFORM_REGION: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
  PLATFORM_ENV: z.string().regex(/^[a-z][a-z0-9-]{0,14}$/),
  PLATFORM_AVAILABILITY_ZONES: z.string(),
  PLATFORM_SITE_ORIGIN: z.string().url(),
  API_IMAGE_TAG: z.string().regex(/^[a-f0-9]{40}$/),
  API_WEATHER_PROVIDER: selector(["mock", "wttr"]),
  API_PLACES_PROVIDER: selector(["mock", "overpass"]),
  API_EVENTS_PROVIDER: selector(["mock", "ticketmaster"]),
  API_LLM_PROVIDER: selector(["mock", "openai", "anthropic"]),
  API_LLM_MODEL: z.preprocess(
    blankAsUnset,
    z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/)
      .optional()
  ),
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
