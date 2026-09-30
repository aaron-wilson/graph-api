import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { parseEnv } from "../config/env.js";

export function startTelemetry(config: ReturnType<typeof parseEnv>) {
  if (config.telemetryMode === "off") return null;
  const endpoint = config.otlpEndpoint;
  if (!endpoint) throw new Error("Invalid configuration: OTEL_EXPORTER_OTLP_ENDPOINT");
  const url = (signal: string) => new URL(`/v1/${signal}`, endpoint).toString();
  const sdk = new NodeSDK({
    serviceName: "wander-graph",
    traceExporter: new OTLPTraceExporter({ url: url("traces"), timeoutMillis: 3000 }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: url("metrics"), timeoutMillis: 3000 }),
      exportIntervalMillis: 10000,
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor(new OTLPLogExporter({ url: url("logs"), timeoutMillis: 3000 }), {
        maxQueueSize: 512,
        maxExportBatchSize: 128,
        scheduledDelayMillis: 5000,
      }),
    ],
  });
  sdk.start();
  return sdk;
}
