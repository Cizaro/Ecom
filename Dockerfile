# Production image for the web app and the worker (same image, different command).
#
#   docker build -t ecom .
#   docker run --env-file .env.production ecom                 # web, port 3000
#   docker run --env-file .env.production ecom worker          # background jobs
#   docker run --env-file .env.production ecom migrate         # apply database changes
#
# Configuration comes only from environment variables at run time; no secret
# is ever built into the image (see .dockerignore).

FROM node:26.13.0-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.18.0 && npm cache clean --force
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# The build needs a syntactically valid configuration but no real secrets:
# every page reads its settings when a request arrives.
RUN cp .env.example .env && pnpm --filter @ecom/web build && rm .env

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod 0755 /usr/local/bin/entrypoint
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 1
ENTRYPOINT ["entrypoint"]
CMD ["web"]
