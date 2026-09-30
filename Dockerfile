FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@10.15.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json codegen.ts schema.graphql ./
COPY codegen ./codegen
COPY src ./src
RUN pnpm build

FROM node:24-slim
ENV NODE_ENV=production PORT=4000
WORKDIR /app
RUN useradd --system --uid 10001 wander
COPY --from=build --chown=wander:wander /app/dist ./dist
COPY --from=build --chown=wander:wander /app/node_modules ./node_modules
COPY --from=build --chown=wander:wander /app/package.json ./package.json
USER wander
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server.js"]
