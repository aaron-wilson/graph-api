import { CognitoJwtVerifier } from "aws-jwt-verify";
import { Unauthorized, type AuthPort } from "./port.js";

/** Verifies Cognito access tokens for the configured pool and app client. No bypass path. */
export function createCognitoAuth(
  userPoolId: string,
  clientId: string,
  verify?: (token: string) => Promise<{ sub?: string }>
): AuthPort {
  let verifyToken = verify;
  if (!verifyToken) {
    const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: "access" });
    verifyToken = (token) => verifier.verify(token);
  }
  return {
    async authenticate(header) {
      if (header === null) return null;
      const token = /^Bearer ([^\s]+)$/.exec(header)?.[1];
      if (!token) throw new Unauthorized("Invalid token");
      let subject: string | undefined;
      try {
        subject = (await verifyToken(token)).sub;
      } catch {
        throw new Unauthorized("Invalid token");
      }
      if (!subject) throw new Unauthorized("Invalid token");
      return { id: subject };
    },
  };
}
