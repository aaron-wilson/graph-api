import { randomUUID } from "node:crypto";
import type { Trip } from "../rest/client.js";
import { GenerationLimit } from "./errors.js";

export type GenerationStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";
export interface GenerationEvent {
  id: string;
  seq: number;
  type: "snapshot" | "progress" | "chunk" | "completed" | "failed" | "cancelled";
  status: GenerationStatus;
  tripId: string | null;
  text: string | null;
}
interface Job {
  id: string;
  ownerId: string;
  target: string;
  status: GenerationStatus;
  tripId: string | null;
  seq: number;
  events: { at: number; event: GenerationEvent }[];
  listeners: Set<(event: GenerationEvent) => void>;
  controller: AbortController;
  /** Set just before the REST write; from then on the job ends with the real REST outcome. */
  committing: boolean;
}
const HISTORY_MS = 5 * 60_000;
const MAX_EVENTS = 100;
const MAX_RUNNING = 100;
const MAX_RUNNING_PER_OWNER = 3;
const MAX_RETAINED = 100;

function ownerFromId(id: string) {
  const [encoded, uuid] = id.split(":");
  if (!encoded || !uuid || !/^[0-9a-f-]{36}$/i.test(uuid)) return null;
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** Process-local generation ledger with bounded replay and explicit restart semantics. */
export function createGenerationManager() {
  const jobs = new Map<string, Job>();
  const active = new Map<string, string>();
  const view = (job: Job) => ({ id: job.id, status: job.status, tripId: job.tripId });
  const snapshot = (job: Job): GenerationEvent => ({
    id: job.id,
    seq: job.seq,
    type: "snapshot",
    status: job.status,
    tripId: job.tripId,
    text: null,
  });
  const prune = () => {
    const now = Date.now();
    for (const [id, job] of jobs)
      if (job.status !== "running" && (job.events.at(-1)?.at ?? 0) + HISTORY_MS < now)
        jobs.delete(id);
  };
  const emit = (job: Job, type: GenerationEvent["type"], text: string | null = null) => {
    const event = {
      id: job.id,
      seq: ++job.seq,
      type,
      status: job.status,
      tripId: job.tripId,
      text,
    };
    job.events.push({ at: Date.now(), event });
    job.events = job.events.filter((item) => item.at + HISTORY_MS >= Date.now()).slice(-MAX_EVENTS);
    for (const listener of job.listeners) listener(event);
  };
  const finish = (job: Job, status: GenerationStatus, tripId: string | null = null) => {
    if (job.status !== "running") return;
    job.status = status;
    job.tripId = tripId;
    emit(
      job,
      status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed"
    );
    if (active.get(job.target) === job.id) active.delete(job.target);
    job.listeners.clear();
    const retained = [...jobs.values()].filter((item) => item.status !== "running");
    for (const old of retained.slice(0, Math.max(0, retained.length - MAX_RETAINED)))
      jobs.delete(old.id);
    setTimeout(() => jobs.delete(job.id), HISTORY_MS).unref();
  };
  const lookup = (id: string, ownerId: string) => {
    if (ownerFromId(id) !== ownerId) return null;
    return jobs.get(id) ?? null;
  };
  return {
    owns: (id: string, ownerId: string) => ownerFromId(id) === ownerId,
    start(
      ownerId: string,
      target: string,
      run: (
        signal: AbortSignal,
        emit: (chunk: string) => void,
        commit: () => void
      ) => Promise<Pick<Trip, "id">>
    ) {
      prune();
      const previous = active.get(target);
      if (previous) {
        const job = jobs.get(previous);
        if (job && !job.committing) {
          job.controller.abort();
          finish(job, "cancelled");
        }
      }
      const running = [...jobs.values()].filter((item) => item.status === "running");
      if (
        running.length >= MAX_RUNNING ||
        running.filter((item) => item.ownerId === ownerId).length >= MAX_RUNNING_PER_OWNER
      )
        throw new GenerationLimit();
      const job: Job = {
        id: `${Buffer.from(ownerId).toString("base64url")}:${randomUUID()}`,
        ownerId,
        target,
        status: "running",
        tripId: null,
        seq: 0,
        events: [],
        listeners: new Set(),
        controller: new AbortController(),
        committing: false,
      };
      jobs.set(job.id, job);
      active.set(target, job.id);
      emit(job, "progress", "planning");
      void Promise.resolve().then(async () => {
        try {
          const trip = await run(
            job.controller.signal,
            (chunk) => {
              if (!job.controller.signal.aborted) emit(job, "chunk", chunk);
            },
            () => {
              if (job.controller.signal.aborted) throw new Error("Generation cancelled");
              job.committing = true;
            }
          );
          finish(
            job,
            job.controller.signal.aborted ? "cancelled" : "completed",
            job.controller.signal.aborted ? null : trip.id
          );
        } catch {
          finish(job, job.controller.signal.aborted ? "cancelled" : "failed");
        }
      });
      return view(job);
    },
    cancel(id: string, ownerId: string) {
      const job = lookup(id, ownerId);
      if (!job) return null;
      if (job.committing) return view(job);
      job.controller.abort();
      finish(job, "cancelled");
      return view(job);
    },
    subscribe(
      id: string,
      ownerId: string,
      fromSeq: number,
      listener: (event: GenerationEvent) => void
    ) {
      if (ownerFromId(id) !== ownerId) return null;
      const job = lookup(id, ownerId);
      if (!job) {
        listener({ id, seq: 0, type: "snapshot", status: "interrupted", tripId: null, text: null });
        return () => undefined;
      }
      const oldest = job.events[0]?.event.seq ?? job.seq + 1;
      if (fromSeq > 0 && fromSeq >= oldest - 1 && fromSeq < job.seq)
        job.events
          .filter((item) => item.event.seq > fromSeq)
          .forEach((item) => listener(item.event));
      else listener(snapshot(job));
      if (job.status !== "running") return () => undefined;
      job.listeners.add(listener);
      return () => job.listeners.delete(listener);
    },
    size: () => jobs.size,
    listenerCount: (id: string) => jobs.get(id)?.listeners.size ?? 0,
  };
}
export type GenerationManager = ReturnType<typeof createGenerationManager>;
