import { expect, it, vi } from "vitest";
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
