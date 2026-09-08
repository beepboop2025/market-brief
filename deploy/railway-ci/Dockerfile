FROM node:22-bookworm-slim AS node
FROM python:3.10-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
COPY . /app
WORKDIR /app
# Fail the native Railway PR check when verification fails during the build.
ARG RAILWAY_GIT_COMMIT_SHA
ARG RAILWAY_DEPLOYMENT_ID
# Test an exact head that already includes current main, preserving PR integration coverage.
RUN printf '%s\n' "$RAILWAY_GIT_COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$' \
    && git init /ci-source \
    && git -C /ci-source remote add origin https://github.com/beepboop2025/market-brief.git \
    && git -C /ci-source fetch origin main "$RAILWAY_GIT_COMMIT_SHA" \
    && git -C /ci-source merge-base --is-ancestor refs/remotes/origin/main "$RAILWAY_GIT_COMMIT_SHA" \
    && printf 'RAILWAY_CI_SOURCE_ADMITTED head=%s base=%s\n' \
         "$RAILWAY_GIT_COMMIT_SHA" "$(git -C /ci-source rev-parse refs/remotes/origin/main)"
RUN timeout --signal=TERM --kill-after=15 600 sh deploy/railway-ci/run.sh \
    && printf 'RAILWAY_CI_BUILD_PASS source=%s\n' "$RAILWAY_GIT_COMMIT_SHA"
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["timeout", "--signal=TERM", "--kill-after=15", "600", "sh", "deploy/railway-ci/run.sh"]
