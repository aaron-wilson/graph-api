# Wander GraphQL API

GraphQL Yoga runs the Node/TypeScript aggregation and planning layer. The SDL and generated resolver types describe REST-backed trip views, mutations and generation subscriptions. Request-local DataLoader batches upstream domain reads. Zod validates provider and REST responses; Yoga/Envelop hooks enforce authentication, depth/cost limits and safe error handling.

## Local use

Use the pinned Node 24 runtime baseline and pnpm 10.15.0 lockfile. Dependency setup is explicit: `pnpm install --frozen-lockfile`. Start the sibling REST demo on port 3000 first, then, with installed dependencies:

```sh
DOTENV_CONFIG_PATH=/dev/null node_modules/.bin/tsx src/bootstrap.ts
```

Defaults are `http://localhost:4000/graphql`, `REST_URL=http://localhost:3000`, demo identity and deterministic mock weather/places/events/LLM adapters. Private GraphQL and SSE requests use `Authorization: Bearer demo`. All vendor selectors and selected-only credentials/models are documented in `.env.example`; no vendor key is required by defaults. Real OpenAI, Anthropic, wttr, Overpass and Ticketmaster adapters normalize their boundaries, but their live calls are unverified.

Generation commands return an ID before streaming. The UI reads authenticated `/generations/<id>/events`; GraphQL also exposes a subscription. Replay and monotonically increasing event IDs support reconnect within one process. Jobs, replay buffers and provider caches are process-local: restart loses in-progress generations. Cancellation, provider deadlines and late subscriptions are tested. Cloud infrastructure keeps a single graph task and uses a stop-before-start rollout; horizontal or restart-safe streaming would require shared coordination.

`APP_MODE=live` verifies Cognito access tokens and forwards identity to REST. Both APIs must agree on the pool/client. Live startup never falls back to demo auth. Public share reads return only their permitted projection. GraphQL owns no direct DynamoDB persistence.

## Checks and implementation status

With the sibling hub platform toolchain installed:

```sh
node ../graph-rest-react-stack/scripts/verify-repo.mjs graph-api
```

This invokes installed format/lint/type tools, Vitest provider/config/stream contracts, real-server REST/GraphQL integration, committed schema/resolver generation checks, the TypeScript build, CDK assertions and fake-input offline synth. Integration tests start and stop their own local services with mock vendors.

OpenTelemetry spans, metrics and structured logs are implemented; export defaults off. Optional collector/New Relic routing is configured outside business logic. `infra/` defines ECS Fargate/ALB streaming, selected Secrets Manager injection, SSM references and scoped roles. Offline synth does not verify live deployment. Docker acceptance needs Docker; Cognito, AWS, real provider calls and external exports remain live-unverified. GitHub workflow templates are inactive. The API uses Fargate definitions; Lambda and Step Functions are outside this architecture.

The sibling hub supplies the architecture, provider/streaming references and full-stack evidence index.
