import { Unauthorized, type AuthPort } from "./port.js";

/** Local-only identity that matches the REST demo principal. */
export const demoAuth: AuthPort = {
  async authenticate(header) {
    if (header === null) return null;
    if (header !== "Bearer demo") throw new Unauthorized("Invalid token");
    return { id: "demo" };
  },
};
