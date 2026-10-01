# graph-api

> TypeScript-first GraphQL orchestration with Yoga, typed REST access, streaming, and Cognito.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Database](#database)
- [Authentication & Security](#authentication--security)
- [Testing](#testing)
- [CI/CD](#cicd)
- [Observability](#observability)
- [License](#license)

---

## Overview

The GraphQL layer shapes REST data for the UI and orchestrates planning providers. It uses generated types, request-local batching, validated integrations, and authenticated streaming.

- GraphQL queries/mutations plus generation subscriptions and SSE replay
- Mock or real weather, places, events, and LLM adapters
- Cognito access-token verification and depth/cost limits

---

## Tech Stack

| Layer              | Technology                                         | Role                                                 |
| ------------------ | -------------------------------------------------- | ---------------------------------------------------- |
| Language / runtime | TypeScript 5.9.2 · Node 24                         | Strict ESM service; Node 24 container baseline       |
| Package management | pnpm 10.15.0                                       | Locked independent install                           |
| API                | GraphQL 16.11.0 · Yoga 5.15.1 / Envelop            | Typed schema, HTTP and subscriptions                 |
| Data access        | DataLoader 2.2.3 · Zod 3.25.76                     | Request-scoped REST batching and response validation |
| Authentication     | Cognito · aws-jwt-verify 5.1.0                     | Verify live access tokens                            |
| Providers          | OpenAI 5.20 · Anthropic SDK 0.61 · validated fetch | LLM streaming, wttr, Overpass, Ticketmaster          |
| Testing            | Vitest 5.0.2 · Supertest 7.3                       | Unit and real REST/graph integration                 |
| Deployment         | Docker · CDK · ECS Fargate · ALB                   | Private tasks behind HTTPS routing                   |
| Observability      | OpenTelemetry API 1.9 / SDK 0.203                  | Traces, metrics and correlated logs                  |

---

## Getting Started

Use Node 24 and pnpm 10.15.0. Start the sibling REST service first.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

GraphQL: http://localhost:4000/graphql. Health: `/health`. Private requests use `Authorization: Bearer demo` in default demo mode. GraphiQL/introspection are disabled unless `ALLOW_INTROSPECTION=true`. For a full container alternative, use [hub Compose](https://github.com/aaron-wilson/graph-rest-react-stack); do not run both stacks on the same ports.

---

## Configuration

[.env.example](.env.example) lists runtime settings; [infra/.env.example](infra/.env.example) lists deployment inputs. `REST_URL` defaults to localhost:3000. All `PROVIDER_*` selectors default to mock; only a selected real provider needs its credentials/model. Local bootstrap loads `.env`; deploy apps use explicit environment inputs.

---

## Database

REST owns persistence. GraphQL reaches memory/DynamoDB through its typed REST client and has no database permissions. Generation jobs, replay and caches are process-local: restart interrupts pending work.

---

## Authentication & Security

`APP_MODE=live` requires Cognito pool/client settings shared with REST. Zod validation, depth/cost limits, explicit CORS and safe error mapping protect API boundaries. Public shares expose a read-only projection; live mode never falls back to demo identity.

---

## Testing

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm codegen:check
pnpm build
```

Integration checks require the sibling REST checkout and Bun. `infra:typecheck`, `infra:test` and `infra:synth` use the sibling hub's installed platform toolchain.

---

## CI/CD

Disabled templates live under `.github/workflow-templates/`. `infra/` defines Fargate health checks, scoped roles, selected Secrets Manager injection and a CPU alarm. One graph task uses stop-before-start rollout because streaming state is local. Deployment goes through the hub's dry-run-default orchestration; live AWS operation is not yet verified.

---

## Observability

`TELEMETRY_MODE=off` by default. Opt into OTLP with `OTEL_EXPORTER_OTLP_ENDPOINT`; the hub supplies collector/Jaeger and New Relic profiles. W3C trace context follows graph calls into REST.

---

## License

See [LICENSE](LICENSE).
