import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGIN: z
    .string()
    .url()
    .refine((value) => {
      try {
        return new URL(value).origin === value;
      } catch {
        return false;
      }
    }, "must be an origin")
    .default("http://localhost:3001"),
});
export function parseEnv(input: Record<string, string | undefined>) {
  const result = schema.safeParse(
    Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, value === "" ? undefined : value])
    )
  );
  if (!result.success)
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`
    );
  return Object.freeze({
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    corsOrigin: result.data.CORS_ORIGIN,
  });
}
