// import OpenAI from "openai";
import fetch from "node-fetch";

// Initialize OpenAI client
// const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Mock APIs
async function getMuseumHours() {
  return [
    { name: "City Museum", open: true, ticketsAvailable: true },
    { name: "Art Gallery", open: false, ticketsAvailable: false },
  ];
}

async function getLiveEvents() {
  return [
    { name: "Jazz Night", available: true },
    { name: "Rock Concert", available: false },
  ];
}

// Mock LLM call (can also be your token-saving switch version)
async function isLiveEvent(preference: string): Promise<boolean> {
  const normalized = preference.toLowerCase();
  switch (true) {
    case normalized.includes("music"):
    case normalized.includes("concert"):
    case normalized.includes("comedy"):
    case normalized.includes("theater"):
    case normalized.includes("live show"):
      return true;
    default:
      return false;
  }
}

// Weather API
async function getCurrentWeather(city: string): Promise<string> {
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`
    );
    const data = await res.json();
    return data.current_condition?.[0]?.weatherDesc?.[0]?.value ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

/**
 * Generates a 3-day itinerary using an LLM.
 * @param city - The city to plan for
 * @param currentWeather - Current weather description
 * @param prioritizedActivities - User preferences / activities
 * @param activityOptions - Filtered/available activity options
 */
async function synthesizeItinerary(
  city: string,
  currentWeather: string,
  prioritizedActivities: string[],
  activityOptions: string[]
): Promise<string> {
  const prompt = `
    You are a travel planning AI.
    City: ${city}
    Weather: ${currentWeather}
    User Preferences: ${prioritizedActivities.join(", ")}
    Candidate activities: ${activityOptions.join(", ")}

    Create a detailed 3-day itinerary. Decide the order, suggest alternatives if needed, and explain reasoning for each choice.
    `;

  //   const response = await client.chat.completions.create({
  //     model: "gpt-4o-mini",
  //     messages: [{ role: "user", content: prompt }],
  //   });

  const response = {
    choices: [
      {
        message: {
          content: "Here is a detailed 3-day itinerary ...",
          prompt, // not actually needed
        },
      },
    ],
  };

  return response.choices[0].message?.content ?? "Could not generate itinerary";
}

export const resolvers = {
  Query: {
    planTrip: async (
      _: unknown,
      { city, preferences }: { city: string; preferences: string[] }
    ) => {
      // Step 1: Gather user preferences (prioritized)
      const prioritizedActivities = preferences;

      // Step 2: Fetch external data
      const museums = await getMuseumHours(city);
      const events = await getLiveEvents(city);
      const currentWeather = await getCurrentWeather(city);

      // Step 3: Determine which preferences are live events via mock LLM
      const liveEventFlags = await Promise.all(
        prioritizedActivities.map(async (act) => ({
          activity: act,
          isLiveEvent: await isLiveEvent(act),
        }))
      );

      // Step 4: Map activities into options with branching
      const activityOptions = prioritizedActivities.flatMap((act) => {
        switch (true) {
          case act.toLowerCase().includes("museum"): {
            const museum = museums.find((m) => m.open && m.ticketsAvailable);
            return museum ? [`Visit ${museum.name}`] : [];
          }
          case liveEventFlags.find((f) => f.activity === act)?.isLiveEvent: {
            const event = events.find((e) => e.available);
            return event ? [`Attend ${event.name}`] : [];
          }
          case act.toLowerCase().includes("walking"): {
            if (
              currentWeather.toLowerCase() === "rain" ||
              currentWeather.toLowerCase() === "snow"
            ) {
              return [];
            } else {
              return ["Outdoor walking tour"];
            }
          }
          default:
            return [act]; // coffee shops or other activities
        }
      });

      // Step 5: Handle empty activity options
      if (activityOptions.length === 0) {
        if (
          currentWeather.toLowerCase().includes("rain") ||
          currentWeather.toLowerCase() === "snow"
        ) {
          activityOptions.push("Read a book");
        } else {
          activityOptions.push("Go for a walk");
        }
      } //

      // Step 6: Synthesize itinerary via LLM
      const itinerary = await synthesizeItinerary(
        city,
        currentWeather,
        prioritizedActivities,
        activityOptions
      );

      return itinerary;
    },
  },
};
