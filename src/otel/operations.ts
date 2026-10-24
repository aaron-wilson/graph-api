import { context, metrics, propagation, trace, SpanStatusCode } from "@opentelemetry/api";
import { ProviderError } from "../providers/port.js";

const tracer = trace.getTracer("wander-graph");
const meter = metrics.getMeter("wander-graph");
const duration = meter.createHistogram("wander.operation.duration", { unit: "ms" });
const errors = meter.createCounter("wander.operation.errors");
export function recordFailure(operation: string) {
  errors.add(1, { operation });
}

export async function observed<T>(name: string, operation: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    const start = performance.now();
    try {
      return await operation();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (error instanceof ProviderError) {
        span.setAttribute("wander.provider.error", error.code);
        if (name.startsWith("provider.")) error.provider ??= name.slice("provider.".length);
      }
      errors.add(1, { operation: name });
      throw error;
    } finally {
      duration.record(performance.now() - start, { operation: name });
      span.end();
    }
  });
}

export function incomingContext(traceparent: string | undefined) {
  return propagation.extract(context.active(), { traceparent: traceparent ?? "" });
}

export function injectContext(headers: Record<string, string>) {
  propagation.inject(context.active(), headers);
}
