import { z } from "zod";

const MAX_RESPONSE_BYTES = 1_000_000;
const PUBLIC_STATUSES = new Set([400, 401, 403, 404, 409, 429]);

export const activitySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  pinned: z.boolean(),
});
export const daySchema = z.object({
  id: z.string().uuid(),
  date: z.string().date(),
  activities: z.array(activitySchema),
});
export const preferencesSchema = z.object({
  interests: z.array(z.string()),
  pace: z.enum(["relaxed", "balanced", "busy"]),
});
const shareSchema = z.object({
  token: z.string(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export const tripSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().min(1),
  city: z.string(),
  preferences: preferencesSchema,
  days: z.array(daySchema),
  share: shareSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive(),
});
export const publicTripSchema = tripSchema.pick({
  id: true,
  city: true,
  days: true,
  updatedAt: true,
});
const pageSchema = z.object({ items: z.array(tripSchema), nextCursor: z.string().nullable() });
const batchSchema = z.object({ items: z.array(tripSchema) });

export type Activity = z.infer<typeof activitySchema>;
export type Day = z.infer<typeof daySchema>;
export type Preferences = z.infer<typeof preferencesSchema>;
export type Trip = z.infer<typeof tripSchema>;
export type PublicTrip = z.infer<typeof publicTripSchema>;
export interface NewTrip {
  city: string;
  preferences: Preferences;
  days: Day[];
}

/** A failed REST call; status is the upstream client error, or 502 for anything unsafe to relay. */
export class RestError extends Error {
  constructor(public readonly status: number) {
    super("Trip service request failed");
  }
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new RestError(502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (let result = await reader.read(); !result.done; result = await reader.read()) {
      size += result.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new RestError(502);
      chunks.push(result.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RestError(502);
  }
}

const tripPath = (id: string, suffix = "") => `/trips/${encodeURIComponent(id)}${suffix}`;

/**
 * REST client bound to one caller's Authorization header. It never retries: reads are cheap to
 * re-request from the browser, and replaying a versioned mutation could double-apply it.
 */
export function createRestClient(
  baseUrl: string,
  authorization: string | null,
  timeoutMs: number,
  transport: typeof fetch = fetch
) {
  async function call<T extends z.ZodTypeAny>(
    path: string,
    schema: T,
    init: { method?: string; body?: unknown; anonymous?: boolean } = {}
  ): Promise<z.infer<T>> {
    const headers: Record<string, string> = {};
    if (!init.anonymous) {
      if (!authorization) throw new RestError(401);
      headers.Authorization = authorization;
    }
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await transport(new URL(path, baseUrl), {
        method: init.method ?? "GET",
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new RestError(502);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new RestError(PUBLIC_STATUSES.has(response.status) ? response.status : 502);
    }
    const parsed = schema.safeParse(await readJson(response));
    if (!parsed.success) throw new RestError(502);
    return parsed.data;
  }
  return {
    list(limit: number, cursor: string | null) {
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor) query.set("cursor", cursor);
      return call(`/trips?${query.toString()}`, pageSchema);
    },
    async batch(ids: readonly string[]) {
      return (await call("/trips/batch", batchSchema, { method: "POST", body: { ids } })).items;
    },
    create: (input: NewTrip) => call("/trips", tripSchema, { method: "POST", body: input }),
    update: (id: string, version: number, changes: Partial<NewTrip>) =>
      call(tripPath(id), tripSchema, { method: "PATCH", body: { version, changes } }),
    pin: (id: string, version: number, activityId: string, pinned: boolean) =>
      call(tripPath(id, "/pin"), tripSchema, {
        method: "POST",
        body: { version, activityId, pinned },
      }),
    swap: (id: string, version: number, activityId: string, replacement: Activity) =>
      call(tripPath(id, "/swap"), tripSchema, {
        method: "POST",
        body: { version, activityId, replacement },
      }),
    share: (id: string, version: number) =>
      call(tripPath(id, "/share"), shareSchema, { method: "POST", body: { version } }),
    async shared(ownerId: string, tripId: string, token: string) {
      const path = ["shared", ownerId, tripId, token].map(encodeURIComponent).join("/");
      try {
        return await call(`/${path}`, publicTripSchema, { anonymous: true });
      } catch (error) {
        if (error instanceof RestError && error.status === 404) return null;
        throw error;
      }
    },
  };
}
export type RestClient = ReturnType<typeof createRestClient>;
