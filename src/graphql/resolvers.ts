// import OpenAI from "openai";
// import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../lib/utils.js";

// Initialize clients
// https://platform.openai.com
// costs $5 to start
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// https://console.anthropic.com
// costs $5 to start
// const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Mock API
async function getMuseumHours() {
  logger.debug("Fetching museum hours");
  return [
    { name: "City Museum", open: true, ticketsAvailable: true },
    { name: "Art Gallery", open: false, ticketsAvailable: false },
  ];
}

// Mock API
async function getLiveEvents() {
  logger.debug("Fetching live events");
  return [
    { name: "Jazz Night", available: true },
    { name: "Rock Concert", available: false },
  ];
}

// Weather API
async function getCurrentWeather(city: string): Promise<string> {
  logger.info("Fetching weather data", { city });
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`
    );
    const data = await res.json();
    const weather =
      data.current_condition?.[0]?.weatherDesc?.[0]?.value ?? "Unknown";
    logger.debug("Weather data retrieved", { city, weather });
    return weather;
  } catch (error) {
    logger.error("Failed to fetch weather data", { city, error });
    return "Unknown";
  }
}

// Mock LLM call
async function isLiveEvent(preference: string): Promise<boolean> {
  const normalized = preference.toLowerCase();
  switch (true) {
    case normalized.includes("music"):
    case normalized.includes("concert"):
    case normalized.includes("comedy"):
    case normalized.includes("theater"):
    case normalized.includes("play"):
    case normalized.includes("live"):
    case normalized.includes("show"):
    case normalized.includes("event"):
      return true;
    default:
      return false;
  }
}

/**
 * Determine if an activity is outdoor AND suitable given current weather.
 * Returns true only if both conditions are satisfied.
 */
async function isSuitableOutdoorActivity(
  activity: string,
  weather: string
): Promise<boolean> {
  logger.debug("LLM check outdoor suitability", { activity, weather });

  // const prompt = `
  //   Activity: "${activity}"
  //   Current weather: "${weather}"

  //   Question: Is this activity an outdoor activity AND is the weather suitable for it?

  //   Answer only "yes" or "no" without quotes.
  // `;

  try {
    // const response = await anthropic.messages.create({
    //   model: "claude-3-5-sonnet-20240620",
    //   max_tokens: 10,
    //   messages: [{ role: "user", content: prompt }],
    // });

    // const answer = response.content[0]?.text?.toLowerCase().trim();
    // return answer?.startsWith("yes") ?? false;

    // const response = await openai.chat.completions.create({
    //   model: "gpt-4o-mini",
    //   messages: [{ role: "user", content: prompt }],
    // });

    // logger.debug("response", { response });
    // return response.choices[0]?.message?.content?.toLowerCase().trim().startsWith("yes") ?? false;

    return false;
  } catch (err) {
    logger.error("isSuitableOutdoorActivity failed", { err });
    return false;
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

  try {
    // const response = await openai.chat.completions.create({
    //   model: "gpt-4o-mini",
    //   messages: [{ role: "user", content: prompt }],
    // });

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

    logger.debug("response", { response });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Something went wrong");
    return content;
  } catch (err) {
    logger.error("synthesizeItinerary failed", { err });
    return "Could not generate itinerary";
  }
}

export const resolvers = {
  Query: {
    /**
     * planTrip resolver
     *
     * Generates a 3-day personalized travel itinerary for a given city based on user preferences.
     *
     * @param _ - GraphQL parent object (unused)
     * @param city - The city to plan the trip for
     * @param preferences - List of user preferences (e.g., museums, coffee shops, walking tours, music events)
     * @returns {{ itinerary: string, currentWeather?: string, activityOptions?: string[] }}
     *
     * Example GraphQL query:
     *
     * query {
     *   planTrip(
     *     city: "Barcelona",
     *     preferences: [
     *       "museums",
     *       "coffee shops",
     *       "walking tours",
     *       "music events"
     *     ]
     *   ) {
     *     itinerary
     *     currentWeather
     *     activityOptions
     *   }
     * }
     *
     * Corresponding curl command:
     *
     * curl -X POST http://localhost:4000/graphql \
     *   -H "Content-Type: application/json" \
     *   -d '{"query":"query { planTrip(city: \"Barcelona\", preferences: [\"museums\",\"coffee shops\",\"walking tours\",\"music events\"]) { itinerary currentWeather activityOptions } }"}'
     */
    planTrip: async (
      _: unknown,
      { city, preferences }: { city: string; preferences: string[] }
    ) => {
      logger.info("Planning trip", { city, preferences });

      // Gather user preferences (prioritized)
      const prioritizedActivities = preferences;

      // Fetch external data
      const museums = await getMuseumHours();
      const events = await getLiveEvents();
      const currentWeather = await getCurrentWeather(city);

      // Determine which preferences are live events via mock LLM
      const liveEventFlags = await Promise.all(
        prioritizedActivities.map(async (act) => ({
          activity: act,
          isLiveEvent: await isLiveEvent(act),
        }))
      );

      // Map activities into options with branching
      const activityOptionsArrays = await Promise.all(
        prioritizedActivities.map(async (act) => {
          const normalized = act.toLowerCase();

          // Handle museums
          if (normalized.includes("museum")) {
            const museum = museums.find((m) => m.open && m.ticketsAvailable);
            return museum ? [`Visit ${museum.name}`] : [];
          }

          // Handle live events
          const liveEventFlag = liveEventFlags.find(
            (f) => f.activity === act
          )?.isLiveEvent;
          if (liveEventFlag) {
            const event = events.find((e) => e.available);
            return event ? [`Attend ${event.name}`] : [];
          }

          // Catch-all: async check for outdoor suitability
          const suitableOutdoorActivity = await isSuitableOutdoorActivity(
            act,
            currentWeather
          );
          return suitableOutdoorActivity ? [`Enjoy ${act}`] : [];
        })
      );
      const activityOptions = activityOptionsArrays.flat();

      // Synthesize itinerary via LLM
      const itinerary = await synthesizeItinerary(
        city,
        currentWeather,
        prioritizedActivities,
        activityOptions
      );

      logger.info("planTrip completed", {
        itinerary,
        currentWeather,
        activityOptions,
      });

      return {
        itinerary,
        currentWeather,
        activityOptions,
      };
    },
  },
};
