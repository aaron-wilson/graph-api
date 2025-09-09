// src/schema.ts
import { createSchema } from 'graphql-yoga';
import { resolvers } from './resolvers';

export const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type Query {
      planTrip(
        city: String!
        preferences: [String!]!
      ): String!
    }
  `,
  resolvers, // link external resolvers here
});
