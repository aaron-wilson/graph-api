import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Principal } from "../auth/port.js";
import type { PlanningProviders } from "../providers/port.js";
import type { RestClient, Trip } from "../rest/client.js";
import { InvalidInput, TripNotFound, Unauthenticated } from "./errors.js";
import { createTripLoader, type TripLoader } from "./loader.js";
import { gatherIdeas, planDays, refineDays } from "./planner.js";

const id = z.string().uuid();
const version = z.number().int().positive();
const preferences = z.object({
  interests: z.array(z.string().trim().min(1).max(80)).max(20),
  pace: z.enum(["relaxed", "balanced", "busy"]),
});
const createInput = z.object({
  city: z.string().trim().min(1).max(100),
  startDate: z.string().date(),
  dayCount: z.number().int().min(1).max(30),
  preferences,
});
const refineInput = z.object({ tripId: id, version, preferences: preferences.nullish() });
const pinInput = z.object({ tripId: id, version, activityId: id, pinned: z.boolean() });
const swapInput = z.object({
  tripId: id,
  version,
  activityId: id,
  title: z.string().trim().min(1).max(120),
});
const shareInput = z.object({ tripId: id, version });
const pageInput = z.object({
  first: z.number().int().min(1).max(100),
  after: z.string().nullish(),
});
const sharedInput = z.object({
  ownerId: z.string().min(1).max(200),
  tripId: id,
  token: z.string().min(1).max(200),
});

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new InvalidInput("Invalid input");
  return result.data;
}

export interface TripServiceDeps {
  rest: RestClient;
  providers: PlanningProviders;
  principal: Principal | null;
  signal?: AbortSignal;
  newId?: () => string;
}

/**
 * Trip orchestration for one request. Reads go through a request-scoped DataLoader; every write
 * replaces that loader entry with the REST response so later fields never see a stale version.
 */
export function createTripService({
  rest,
  providers,
  principal,
  signal,
  newId = randomUUID,
}: TripServiceDeps) {
  const loader: TripLoader | null = principal ? createTripLoader(rest, principal.id) : null;
  function owned() {
    if (!loader) throw new Unauthenticated();
    return loader;
  }
  function remember(trip: Trip) {
    owned().clear(trip.id).prime(trip.id, trip);
    return trip;
  }
  async function existing(tripId: string) {
    const trip = await owned().load(tripId);
    if (!trip) throw new TripNotFound();
    return trip;
  }
  async function generatedIdeas(
    city: string,
    interests: readonly string[],
    emit: (chunk: string) => void,
    generationSignal: AbortSignal
  ) {
    const ideas = await gatherIdeas(providers, city, interests, generationSignal);
    const chunks: string[] = [];
    for await (const chunk of providers.llm.stream(
      `Plan activities in ${city} for ${interests.join(", ")}`,
      generationSignal
    )) {
      chunks.push(chunk);
      emit(chunk);
    }
    const title = chunks.join("").trim().slice(0, 120);
    return title ? [title, ...ideas] : ideas;
  }
  return {
    trip: (tripId: string) => owned().load(parse(id, tripId)),
    async trips(input: { first: number; after?: string | null }) {
      const { first, after } = parse(pageInput, input);
      owned();
      const page = await rest.list(first, after ?? null);
      page.items.forEach(remember);
      return page;
    },
    sharedTrip(input: { ownerId: string; tripId: string; token: string }) {
      const { ownerId, tripId, token } = parse(sharedInput, input);
      return rest.shared(ownerId, tripId, token);
    },
    async createTrip(input: unknown) {
      const plan = parse(createInput, input);
      owned();
      const ideas = await gatherIdeas(providers, plan.city, plan.preferences.interests, signal);
      const days = planDays(ideas, plan.startDate, plan.dayCount, plan.preferences.pace, newId);
      return remember(await rest.create({ city: plan.city, preferences: plan.preferences, days }));
    },
    async generateCreate(
      input: unknown,
      emit: (chunk: string) => void,
      generationSignal: AbortSignal
    ) {
      const plan = parse(createInput, input);
      owned();
      const ideas = await generatedIdeas(
        plan.city,
        plan.preferences.interests,
        emit,
        generationSignal
      );
      if (generationSignal.aborted) throw new Error("Generation cancelled");
      const days = planDays(ideas, plan.startDate, plan.dayCount, plan.preferences.pace, newId);
      return remember(await rest.create({ city: plan.city, preferences: plan.preferences, days }));
    },
    async refineTrip(input: unknown) {
      const change = parse(refineInput, input);
      const trip = await existing(change.tripId);
      const next = change.preferences ?? trip.preferences;
      const ideas = await gatherIdeas(providers, trip.city, next.interests, signal);
      const days = refineDays(trip.days, ideas, next.pace, newId);
      return remember(await rest.update(trip.id, change.version, { preferences: next, days }));
    },
    async generateRefine(
      input: unknown,
      emit: (chunk: string) => void,
      generationSignal: AbortSignal
    ) {
      const change = parse(refineInput, input);
      const trip = await existing(change.tripId);
      const next = change.preferences ?? trip.preferences;
      const ideas = await generatedIdeas(trip.city, next.interests, emit, generationSignal);
      if (generationSignal.aborted) throw new Error("Generation cancelled");
      const days = refineDays(trip.days, ideas, next.pace, newId);
      return remember(await rest.update(trip.id, change.version, { preferences: next, days }));
    },
    async pinActivity(input: unknown) {
      const pin = parse(pinInput, input);
      owned();
      return remember(await rest.pin(pin.tripId, pin.version, pin.activityId, pin.pinned));
    },
    async swapActivity(input: unknown) {
      const swap = parse(swapInput, input);
      owned();
      const replacement = { id: newId(), title: swap.title, pinned: false };
      return remember(await rest.swap(swap.tripId, swap.version, swap.activityId, replacement));
    },
    async shareTrip(input: unknown) {
      const share = parse(shareInput, input);
      owned();
      await rest.share(share.tripId, share.version);
      owned().clear(share.tripId);
      return existing(share.tripId);
    },
  };
}
export type TripService = ReturnType<typeof createTripService>;
