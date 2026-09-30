import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "../src/config/env.js";
import { startTelemetry } from "../src/otel/init.js";
import { createLogger } from "../src/lib/utils.js";

describe("telemetry boundary", () => {
  it("does not create exporters in the default mode", () => {
    expect(startTelemetry(parseEnv({}))).toBeNull();
  });

  it("accepts only an OTLP URL when enabled", () => {
    expect(() => parseEnv({ TELEMETRY_MODE: "otlp" })).toThrow("OTEL_EXPORTER_OTLP_ENDPOINT");
  });

  it("drops unapproved log fields", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    createLogger("info")("error", "request_error", { name: "Error", token: "private" });
    expect(write).toHaveBeenCalledWith(expect.not.stringContaining("private"));
    write.mockRestore();
  });
});
