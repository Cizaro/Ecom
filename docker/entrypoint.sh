#!/bin/sh
# Starts what the container is for. One image, three uses.
set -e
case "$1" in
  web)
    exec pnpm --filter @ecom/web exec next start --hostname 0.0.0.0 --port "${PORT:-3000}"
    ;;
  worker)
    exec pnpm --filter @ecom/worker start
    ;;
  migrate)
    exec pnpm db:migrate
    ;;
  *)
    exec "$@"
    ;;
esac
