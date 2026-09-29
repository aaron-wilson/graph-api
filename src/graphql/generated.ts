import type { GraphQLResolveInfo } from 'graphql';
import type { Trip as TripRecord, PublicTrip as PublicTripRecord } from '../rest/client.js';
import type { GraphContext } from './context.js';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type Activity = {
  __typename?: 'Activity';
  id: Scalars['ID']['output'];
  pinned: Scalars['Boolean']['output'];
  title: Scalars['String']['output'];
};

export type CreateTripInput = {
  city: Scalars['String']['input'];
  dayCount: Scalars['Int']['input'];
  preferences: PreferencesInput;
  /** First day, YYYY-MM-DD. */
  startDate: Scalars['String']['input'];
};

export type Day = {
  __typename?: 'Day';
  activities: Array<Activity>;
  /** Calendar date, YYYY-MM-DD. */
  date: Scalars['String']['output'];
  id: Scalars['ID']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /** Plans activities with the configured providers and saves the trip. */
  createTrip: Trip;
  pinActivity: Trip;
  /** Replans every unpinned activity, optionally with new preferences. */
  refineTrip: Trip;
  /** Creates or replaces the public share link. */
  shareTrip: Trip;
  /** Replaces one unpinned activity with a new titled activity. */
  swapActivity: Trip;
};


export type MutationCreateTripArgs = {
  input: CreateTripInput;
};


export type MutationPinActivityArgs = {
  input: PinActivityInput;
};


export type MutationRefineTripArgs = {
  input: RefineTripInput;
};


export type MutationShareTripArgs = {
  input: ShareTripInput;
};


export type MutationSwapActivityArgs = {
  input: SwapActivityInput;
};

export type Pace =
  | 'balanced'
  | 'busy'
  | 'relaxed';

export type PinActivityInput = {
  activityId: Scalars['ID']['input'];
  pinned: Scalars['Boolean']['input'];
  tripId: Scalars['ID']['input'];
  version: Scalars['Int']['input'];
};

export type Preferences = {
  __typename?: 'Preferences';
  interests: Array<Scalars['String']['output']>;
  pace: Pace;
};

export type PreferencesInput = {
  interests: Array<Scalars['String']['input']>;
  pace: Pace;
};

/** Wander trip graph. REST owns trip persistence; this graph plans activities and batches reads. */
export type Query = {
  __typename?: 'Query';
  /** A read-only public projection; requires no authentication. */
  sharedTrip: Maybe<SharedTrip>;
  /** An owned trip, or null when it does not exist for the caller. */
  trip: Maybe<Trip>;
  /** Owned trips in stable REST cursor order. */
  trips: TripPage;
};


/** Wander trip graph. REST owns trip persistence; this graph plans activities and batches reads. */
export type QuerySharedTripArgs = {
  ownerId: Scalars['ID']['input'];
  token: Scalars['String']['input'];
  tripId: Scalars['ID']['input'];
};


/** Wander trip graph. REST owns trip persistence; this graph plans activities and batches reads. */
export type QueryTripArgs = {
  id: Scalars['ID']['input'];
};


/** Wander trip graph. REST owns trip persistence; this graph plans activities and batches reads. */
export type QueryTripsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: Scalars['Int']['input'];
};

export type RefineTripInput = {
  preferences?: InputMaybe<PreferencesInput>;
  tripId: Scalars['ID']['input'];
  version: Scalars['Int']['input'];
};

export type ShareLink = {
  __typename?: 'ShareLink';
  createdAt: Scalars['String']['output'];
  expiresAt: Scalars['String']['output'];
  token: Scalars['String']['output'];
};

export type ShareTripInput = {
  tripId: Scalars['ID']['input'];
  version: Scalars['Int']['input'];
};

export type SharedTrip = {
  __typename?: 'SharedTrip';
  city: Scalars['String']['output'];
  days: Array<Day>;
  id: Scalars['ID']['output'];
  updatedAt: Scalars['String']['output'];
};

export type SwapActivityInput = {
  activityId: Scalars['ID']['input'];
  title: Scalars['String']['input'];
  tripId: Scalars['ID']['input'];
  version: Scalars['Int']['input'];
};

export type Trip = {
  __typename?: 'Trip';
  city: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  days: Array<Day>;
  id: Scalars['ID']['output'];
  ownerId: Scalars['ID']['output'];
  preferences: Preferences;
  share: Maybe<ShareLink>;
  updatedAt: Scalars['String']['output'];
  /** Optimistic concurrency version; pass it back to every mutation. */
  version: Scalars['Int']['output'];
};

export type TripPage = {
  __typename?: 'TripPage';
  items: Array<Trip>;
  nextCursor: Maybe<Scalars['String']['output']>;
};

export type WithIndex<TObject> = TObject & Record<string, any>;
export type ResolversObject<TObject> = WithIndex<TObject>;

export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;





/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = ResolversObject<{
  Activity: ResolverTypeWrapper<Activity>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  CreateTripInput: CreateTripInput;
  Day: ResolverTypeWrapper<Day>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  Pace: null;
  PinActivityInput: PinActivityInput;
  Preferences: ResolverTypeWrapper<Preferences>;
  PreferencesInput: PreferencesInput;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  RefineTripInput: RefineTripInput;
  ShareLink: ResolverTypeWrapper<ShareLink>;
  ShareTripInput: ShareTripInput;
  SharedTrip: ResolverTypeWrapper<PublicTripRecord>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  SwapActivityInput: SwapActivityInput;
  Trip: ResolverTypeWrapper<TripRecord>;
  TripPage: ResolverTypeWrapper<Omit<TripPage, 'items'> & { items: Array<ResolversTypes['Trip']> }>;
}>;

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = ResolversObject<{
  Activity: Activity;
  Boolean: Scalars['Boolean']['output'];
  CreateTripInput: CreateTripInput;
  Day: Day;
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  Mutation: Record<PropertyKey, never>;
  PinActivityInput: PinActivityInput;
  Preferences: Preferences;
  PreferencesInput: PreferencesInput;
  Query: Record<PropertyKey, never>;
  RefineTripInput: RefineTripInput;
  ShareLink: ShareLink;
  ShareTripInput: ShareTripInput;
  SharedTrip: PublicTripRecord;
  String: Scalars['String']['output'];
  SwapActivityInput: SwapActivityInput;
  Trip: TripRecord;
  TripPage: Omit<TripPage, 'items'> & { items: Array<ResolversParentTypes['Trip']> };
}>;

export type ActivityResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['Activity'] = ResolversParentTypes['Activity']> = ResolversObject<{
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  pinned?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  title?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
}>;

export type DayResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['Day'] = ResolversParentTypes['Day']> = ResolversObject<{
  activities?: Resolver<Array<ResolversTypes['Activity']>, ParentType, ContextType>;
  date?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
}>;

export type MutationResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = ResolversObject<{
  createTrip?: Resolver<ResolversTypes['Trip'], ParentType, ContextType, RequireFields<MutationCreateTripArgs, 'input'>>;
  pinActivity?: Resolver<ResolversTypes['Trip'], ParentType, ContextType, RequireFields<MutationPinActivityArgs, 'input'>>;
  refineTrip?: Resolver<ResolversTypes['Trip'], ParentType, ContextType, RequireFields<MutationRefineTripArgs, 'input'>>;
  shareTrip?: Resolver<ResolversTypes['Trip'], ParentType, ContextType, RequireFields<MutationShareTripArgs, 'input'>>;
  swapActivity?: Resolver<ResolversTypes['Trip'], ParentType, ContextType, RequireFields<MutationSwapActivityArgs, 'input'>>;
}>;

export type PaceResolvers = { BALANCED: 'balanced', BUSY: 'busy', RELAXED: 'relaxed' };

export type PreferencesResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['Preferences'] = ResolversParentTypes['Preferences']> = ResolversObject<{
  interests?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  pace?: Resolver<ResolversTypes['Pace'], ParentType, ContextType>;
}>;

export type QueryResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = ResolversObject<{
  sharedTrip?: Resolver<Maybe<ResolversTypes['SharedTrip']>, ParentType, ContextType, RequireFields<QuerySharedTripArgs, 'ownerId' | 'token' | 'tripId'>>;
  trip?: Resolver<Maybe<ResolversTypes['Trip']>, ParentType, ContextType, RequireFields<QueryTripArgs, 'id'>>;
  trips?: Resolver<ResolversTypes['TripPage'], ParentType, ContextType, RequireFields<QueryTripsArgs, 'first'>>;
}>;

export type ShareLinkResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['ShareLink'] = ResolversParentTypes['ShareLink']> = ResolversObject<{
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  expiresAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  token?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
}>;

export type SharedTripResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['SharedTrip'] = ResolversParentTypes['SharedTrip']> = ResolversObject<{
  city?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  days?: Resolver<Array<ResolversTypes['Day']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
}>;

export type TripResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['Trip'] = ResolversParentTypes['Trip']> = ResolversObject<{
  city?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  days?: Resolver<Array<ResolversTypes['Day']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  ownerId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  preferences?: Resolver<ResolversTypes['Preferences'], ParentType, ContextType>;
  share?: Resolver<Maybe<ResolversTypes['ShareLink']>, ParentType, ContextType>;
  updatedAt?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  version?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
}>;

export type TripPageResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['TripPage'] = ResolversParentTypes['TripPage']> = ResolversObject<{
  items?: Resolver<Array<ResolversTypes['Trip']>, ParentType, ContextType>;
  nextCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
}>;

export type Resolvers<ContextType = GraphContext> = ResolversObject<{
  Activity?: ActivityResolvers<ContextType>;
  Day?: DayResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  Pace?: PaceResolvers;
  Preferences?: PreferencesResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  ShareLink?: ShareLinkResolvers<ContextType>;
  SharedTrip?: SharedTripResolvers<ContextType>;
  Trip?: TripResolvers<ContextType>;
  TripPage?: TripPageResolvers<ContextType>;
}>;



export const typeDefs = "type Activity {\n  id: ID!\n  pinned: Boolean!\n  title: String!\n}\n\ninput CreateTripInput {\n  city: String!\n  dayCount: Int!\n  preferences: PreferencesInput!\n\n  \"\"\"First day, YYYY-MM-DD.\"\"\"\n  startDate: String!\n}\n\ntype Day {\n  activities: [Activity!]!\n\n  \"\"\"Calendar date, YYYY-MM-DD.\"\"\"\n  date: String!\n  id: ID!\n}\n\ntype Mutation {\n  \"\"\"Plans activities with the configured providers and saves the trip.\"\"\"\n  createTrip(input: CreateTripInput!): Trip!\n  pinActivity(input: PinActivityInput!): Trip!\n\n  \"\"\"Replans every unpinned activity, optionally with new preferences.\"\"\"\n  refineTrip(input: RefineTripInput!): Trip!\n\n  \"\"\"Creates or replaces the public share link.\"\"\"\n  shareTrip(input: ShareTripInput!): Trip!\n\n  \"\"\"Replaces one unpinned activity with a new titled activity.\"\"\"\n  swapActivity(input: SwapActivityInput!): Trip!\n}\n\nenum Pace {\n  BALANCED\n  BUSY\n  RELAXED\n}\n\ninput PinActivityInput {\n  activityId: ID!\n  pinned: Boolean!\n  tripId: ID!\n  version: Int!\n}\n\ntype Preferences {\n  interests: [String!]!\n  pace: Pace!\n}\n\ninput PreferencesInput {\n  interests: [String!]!\n  pace: Pace!\n}\n\n\"\"\"\nWander trip graph. REST owns trip persistence; this graph plans activities and batches reads.\n\"\"\"\ntype Query {\n  \"\"\"A read-only public projection; requires no authentication.\"\"\"\n  sharedTrip(ownerId: ID!, token: String!, tripId: ID!): SharedTrip\n\n  \"\"\"An owned trip, or null when it does not exist for the caller.\"\"\"\n  trip(id: ID!): Trip\n\n  \"\"\"Owned trips in stable REST cursor order.\"\"\"\n  trips(after: String, first: Int! = 20): TripPage!\n}\n\ninput RefineTripInput {\n  preferences: PreferencesInput\n  tripId: ID!\n  version: Int!\n}\n\ntype ShareLink {\n  createdAt: String!\n  expiresAt: String!\n  token: String!\n}\n\ninput ShareTripInput {\n  tripId: ID!\n  version: Int!\n}\n\ntype SharedTrip {\n  city: String!\n  days: [Day!]!\n  id: ID!\n  updatedAt: String!\n}\n\ninput SwapActivityInput {\n  activityId: ID!\n  title: String!\n  tripId: ID!\n  version: Int!\n}\n\ntype Trip {\n  city: String!\n  createdAt: String!\n  days: [Day!]!\n  id: ID!\n  ownerId: ID!\n  preferences: Preferences!\n  share: ShareLink\n  updatedAt: String!\n\n  \"\"\"Optimistic concurrency version; pass it back to every mutation.\"\"\"\n  version: Int!\n}\n\ntype TripPage {\n  items: [Trip!]!\n  nextCursor: String\n}";
