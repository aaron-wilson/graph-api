import { context, metrics, propagation, trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("wander-graph");
const meter = metrics.getMeter("wander-graph");
const duration = meter.createHistogram("wander.operation.duration", { unit: "ms" });

export async function observed<T>(name: string, operation: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    const start = performance.now();
    try {
      return await operation();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
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
