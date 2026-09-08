FROM node:22-bookworm-slim AS node
FROM python:3.10-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
COPY . /app
WORKDIR /app
# Fail the native Railway PR check when verification fails during the build.
ARG RAILWAY_GIT_COMMIT_SHA
ARG RAILWAY_DEPLOYMENT_ID
RUN timeout --signal=TERM --kill-after=15 600 sh deploy/railway-ci/run.sh \
    && printf 'RAILWAY_CI_BUILD_PASS source=%s\n' "$RAILWAY_GIT_COMMIT_SHA"
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["timeout", "--signal=TERM", "--kill-after=15", "600", "sh", "deploy/railway-ci/run.sh"]
