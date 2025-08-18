# graph-api

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://github.com/aaron-wilson/graph-api/actions/workflows/ci.yml/badge.svg)](https://github.com/aaron-wilson/graph-api/actions)

> A TypeScript-first, Node-based GraphQL API using Yoga, AWS DynamoDB, and AWS Cognito for secure, scalable, and type-safe serverless operations.

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
- [Contributing](#contributing)
- [License](#license)

---

## Overview

This repository contains the primary GraphQL API for our application ecosystem. It is built with modern TypeScript-first practices and serverless AWS infrastructure, providing a highly maintainable, type-safe, and secure API layer.  

Key features:

- Fully typed GraphQL schema with auto-generated TypeScript types
- Serverless architecture using AWS Lambda and DynamoDB
- Secure authentication and authorization via AWS Cognito
- Comprehensive testing and CI/CD pipeline
- Observability with OpenTelemetry and New Relic integration

---

## Tech Stack

| Layer | Technology | Reasoning / Explanation |
|-------|------------|------------------------|
| Runtime | [Node.js 20](https://nodejs.org/en/) | Latest LTS with ESM-first support for modern JavaScript modules |
| Package Management | [pnpm](https://pnpm.io/) | Efficient, deterministic, and disk-space saving monorepo support |
| API | [GraphQL](https://graphql.org/) | Flexible, self-documenting query language |
| GraphQL Server | [Yoga](https://www.graphql-yoga.com/) | Drop-in Apollo Server replacement, built on [Envelop](https://envelop.dev/) for plugin extensibility |
| Schema | TypeScript-first | Strong typing, autocompletion, and runtime safety via generated types |
| Database | [AWS DynamoDB](https://docs.aws.amazon.com/dynamodb/index.html) | Scalable, serverless NoSQL database with high availability |
| Data Validation | [Zod](https://zod.dev/) | Runtime input/output validation, complements TypeScript types |
| Authentication | [AWS Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html) | Secure JWT-based user authentication |
| Security | CORS, rate limiting, security headers | Standard API hardening practices |
| Testing | [Vitest](https://vitest.dev/) + [Supertest](https://github.com/visionmedia/supertest) | Fast unit tests and GraphQL endpoint integration testing |
| CI/CD | [GitHub Actions](https://docs.github.com/en/actions) + [AWS CDK](https://docs.aws.amazon.com/cdk/) | Automates linting, testing, and deployment of serverless resources |
| Observability | [OpenTelemetry](https://opentelemetry.io/) → [New Relic](https://docs.newrelic.com/docs/) | Full-stack observability: logs, metrics, traces |

---

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- AWS CLI configured with appropriate credentials
- [AWS CDK](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) installed globally

```bash
# Clone the repository
git clone https://github.com/aaron-wilson/graph-api.git
cd primary-api

# Install dependencies
pnpm install

# Run local development server
pnpm dev
```

### Local Development

GraphQL Yoga provides an auto-generated playground for testing queries and mutations locally at [http://localhost:4000/graphql](http://localhost:4000/graphql).

```bash
pnpm dev
```

* Automatically loads environment variables from `.env`
* Hot-reloads on code changes

---

## Configuration

All sensitive credentials are stored in AWS:

* **SSM Parameter Store:** Non-sensitive configuration
* **Secrets Manager:** JWT secrets, database credentials

Environment variables for local development:

```env
AWS_REGION=us-east-1
COGNITO_USER_POOL_ID=your_user_pool_id
COGNITO_CLIENT_ID=your_client_id
DYNAMO_TABLE_NAME=YourDynamoTable
```

---

## Database

We use **AWS DynamoDB** for all data persistence:

* `DocumentClient` for intuitive JSON-based operations
* TypeScript DTOs with Zod validation to ensure runtime type safety
* Serverless scalability and minimal operational overhead

See [DynamoDB Docs](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html) for details.

---

## Authentication & Security

* **JWT Verification** via AWS Cognito
* **CORS** enabled for trusted domains
* **Rate limiting** to prevent abuse
* **Input validation** using Zod
* **Security headers** via Helmet or Yoga plugins

See [AWS Cognito Docs](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html) for setup.

---

## Testing

Unit tests and integration tests are powered by:

* [Vitest](https://vitest.dev/) – Unit and utility tests
* [Supertest](https://github.com/visionmedia/supertest) – GraphQL endpoint integration tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test --watch
```

---

## CI/CD

* **GitHub Actions** workflow: `lint → test → deploy`
* Deployment via **AWS CDK**:

  * Lambda functions
  * Application Load Balancer (ALB)
  * Step Functions
  * IAM roles and policies
  * Secrets and parameters

See [AWS CDK Docs](https://docs.aws.amazon.com/cdk/latest/guide/home.html) for more details.

---

## Observability

* **OpenTelemetry** instrumentation for logs, metrics, and traces
* Forwarded to **New Relic** for full-stack monitoring
* Helps detect performance issues and trace errors in serverless workflows

See [OpenTelemetry Docs](https://opentelemetry.io/docs/) for setup guidance.

---

## Contributing

We welcome contributions! Please follow our guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit changes (`git commit -m 'Add new feature'`)
4. Push to branch (`git push origin feature/my-feature`)
5. Open a pull request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full guidelines.

---

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
