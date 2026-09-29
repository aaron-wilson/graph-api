import type { PlanningProviders } from "../providers/port.js";
import type { Activity, Day, Preferences } from "../rest/client.js";

const DAY_MS = 86_400_000;
const MAX_TITLE = 120;
const ACTIVITIES_PER_DAY: Record<Preferences["pace"], number> = {
  relaxed: 2,
  balanced: 3,
  busy: 4,
};

/** Collects distinct activity ideas from the configured providers; order is deterministic. */
export async function gatherIdeas(
  providers: PlanningProviders,
  city: string,
  interests: readonly string[],
  signal?: AbortSignal
): Promise<string[]> {
  const [weather, places, events] = await Promise.all([
    providers.weather.current(city, signal),
    providers.places.find(city, signal),
    providers.events.find(city, signal),
  ]);
  const ideas = [
    ...interests.map((interest) => `Explore ${interest} in ${city}`),
    ...places.map((place) => `Visit ${place.name}`),
    ...events.map((event) => `Attend ${event.name} (${event.date})`),
    `Walk around ${city} (${weather})`,
  ].map((idea) => idea.slice(0, MAX_TITLE));
  return [...new Set(ideas)];
}

/** Picks up to `count` ideas starting at a rotating offset, skipping titles the day already has. */
function pick(ideas: readonly string[], offset: number, count: number, taken: Set<string>) {
  const chosen: string[] = [];
  for (let step = 0; step < ideas.length && chosen.length < count; step++) {
    const idea = ideas[(offset + step) % ideas.length];
    if (idea !== undefined && !taken.has(idea)) {
      chosen.push(idea);
      taken.add(idea);
    }
  }
  return chosen;
}

export function planDays(
  ideas: readonly string[],
  startDate: string,
  dayCount: number,
  pace: Preferences["pace"],
  newId: () => string
): Day[] {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const perDay = ACTIVITIES_PER_DAY[pace];
  return Array.from({ length: dayCount }, (_, index) => ({
    id: newId(),
    date: new Date(start + index * DAY_MS).toISOString().slice(0, 10),
    activities: pick(ideas, index * perDay, perDay, new Set()).map((title) => ({
      id: newId(),
      title,
      pinned: false,
    })),
  }));
}

/** Keeps pinned activities and replans the rest of each day for the given pace. */
export function refineDays(
  days: readonly Day[],
  ideas: readonly string[],
  pace: Preferences["pace"],
  newId: () => string
): Day[] {
  const perDay = ACTIVITIES_PER_DAY[pace];
  return days.map((day, index) => {
    const pinned = day.activities.filter((activity) => activity.pinned);
    const taken = new Set(pinned.map((activity) => activity.title));
    const added: Activity[] = pick(ideas, index * perDay, perDay - pinned.length, taken).map(
      (title) => ({ id: newId(), title, pinned: false })
    );
    return { ...day, activities: [...pinned, ...added] };
  });
}
