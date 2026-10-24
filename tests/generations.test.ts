import { expect, it, vi } from "vitest";
import { observed } from "../src/otel/operations.js";
import { ProviderError } from "../src/providers/port.js";
import { GenerationLimit } from "../src/trips/errors.js";
import { createGenerationManager, type GenerationEvent } from "../src/trips/generations.js";
const saved = { id: "00000000-0000-4000-8000-000000000001" };

it("replays ordered events, isolates owners and reports interrupted jobs after restart", async () => {
  const manager = createGenerationManager();
  let release = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const job = manager.start("demo", "demo:create", async (_signal, emit) => {
    emit("first");
    await gate;
    emit("second");
    return saved;
  });
  expect(manager.subscribe(job.id, "other", 0, () => undefined)).toBeNull();
  const events: GenerationEvent[] = [];
  const unsubscribe = manager.subscribe(job.id, "demo", 0, (event) => events.push(event));
  await Promise.resolve();
  release();
  await vi.waitFor(() => expect(events.at(-1)?.type).toBe("completed"));
  expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
  expect(events.at(-1)?.tripId).toBe(saved.id);
  expect(manager.listenerCount(job.id)).toBe(0);
  unsubscribe?.();
  const replay: GenerationEvent[] = [];
  manager.subscribe(job.id, "demo", 1, (event) => replay.push(event));
  expect(replay.map((event) => event.seq)).toEqual([2, 3, 4]);
  const restarted = createGenerationManager();
  const interrupted: GenerationEvent[] = [];
  restarted.subscribe(job.id, "demo", 0, (event) => interrupted.push(event));
  expect(interrupted[0]?.status).toBe("interrupted");
});

it("cancels superseded work and releases subscribers and completed jobs", async () => {
  vi.useFakeTimers();
  try {
    const manager = createGenerationManager();
    const first = manager.start("demo", "demo:create", async (signal) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      throw new Error("cancelled");
    });
    const events: GenerationEvent[] = [];
    const stop = manager.subscribe(first.id, "demo", 0, (event) => events.push(event));
    expect(manager.listenerCount(first.id)).toBe(1);
    stop?.();
    expect(manager.listenerCount(first.id)).toBe(0);
    manager.start("demo", "demo:create", async () => saved);
    expect(events.at(-1)?.status).toBe("running");
    expect(manager.cancel(first.id, "demo")?.status).toBe("cancelled");
    expect(manager.cancel(first.id, "other")).toBeNull();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(manager.size()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("counts only running jobs toward capacity and caps each owner", async () => {
  const manager = createGenerationManager();
  for (let index = 0; index < 150; index += 1)
    manager.start("attacker", "attacker:create", async () => {
      throw new Error("failed");
    });
  await vi.waitFor(() => expect(manager.size()).toBeLessThanOrEqual(100));
  expect(manager.start("victim", "victim:create", async () => saved).status).toBe("running");
  const hold = () => new Promise<never>(() => undefined);
  for (const target of ["a", "b"]) manager.start("busy", `busy:${target}`, hold);
  manager.start("busy", "busy:c", hold);
  expect(() => manager.start("busy", "busy:d", hold)).toThrow(GenerationLimit);
  expect(manager.start("busy", "busy:c", hold).status).toBe("running");
  expect(manager.start("other", "other:create", hold).status).toBe("running");
});

it("ends a committing job with its save and cancels work before the write", async () => {
  const manager = createGenerationManager();
  let release = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  let committed = false;
  const saving = manager.start("demo", "demo:create", async (_signal, _emit, commit) => {
    commit();
    committed = true;
    await gate;
    writes += 1;
    return saved;
  });
  await vi.waitFor(() => expect(committed).toBe(true));
  expect(manager.cancel(saving.id, "demo")?.status).toBe("running");
  const early = manager.start("demo", "demo:create", async (_signal, _emit, commit) => {
    await gate;
    commit();
    writes += 1;
    return saved;
  });
  expect(manager.cancel(early.id, "demo")?.status).toBe("cancelled");
  release();
  const final = (id: string) => {
    const events: GenerationEvent[] = [];
    manager.subscribe(id, "demo", 0, (event) => events.push(event));
    return events.at(-1);
  };
  await vi.waitFor(() => expect(final(saving.id)?.status).toBe("completed"));
  expect(final(saving.id)?.tripId).toBe(saved.id);
  expect(final(early.id)).toMatchObject({ status: "cancelled", tripId: null });
  expect(writes).toBe(1);
});

it("sends accumulated text to subscribers that replay cannot serve", async () => {
  const manager = createGenerationManager();
  let release = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waiting = false;
  const job = manager.start("demo", "demo:create", async (_signal, emit) => {
    emit("alpha ");
    emit("beta ");
    for (let index = 0; index < 120; index += 1) emit(".");
    waiting = true;
    await gate;
    emit("gamma");
    return saved;
  });
  await vi.waitFor(() => expect(waiting).toBe(true));
  const fresh: GenerationEvent[] = [];
  const outside: GenerationEvent[] = [];
  manager.subscribe(job.id, "demo", 0, (event) => fresh.push(event));
  // Seq 2 has left the 100-event window, so replay cannot serve it.
  manager.subscribe(job.id, "demo", 2, (event) => outside.push(event));
  release();
  await vi.waitFor(() => expect(outside.at(-1)?.type).toBe("completed"));
  for (const events of [fresh, outside]) {
    expect(events[0]?.type).toBe("snapshot");
    expect(events.map((event) => event.text ?? "").join("")).toBe(
      `alpha beta ${".".repeat(120)}gamma`
    );
    expect(new Set(events.map((event) => event.seq)).size).toBe(events.length);
  }
});

it("reports failed jobs with the failing provider and skips cancelled ones", async () => {
  const failures: unknown[] = [];
  const manager = createGenerationManager((error) => failures.push(error));
  const failed = manager.start("demo", "demo:create", () =>
    observed("planner.gather", () =>
      observed("provider.places", () => Promise.reject(new ProviderError("timeout")))
    )
  );
  const events: GenerationEvent[] = [];
  manager.subscribe(failed.id, "demo", 0, (event) => events.push(event));
  await vi.waitFor(() => expect(events.at(-1)?.status).toBe("failed"));
  expect(failures).toHaveLength(1);
  expect(failures[0]).toMatchObject({ code: "timeout", provider: "places" });
  const cancelled = manager.start("demo", "demo:refine", async (signal) => {
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
    throw new ProviderError("cancelled");
  });
  manager.cancel(cancelled.id, "demo");
  await Promise.resolve();
  expect(failures).toHaveLength(1);
});
