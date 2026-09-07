FROM node:22-bookworm-slim AS node
FROM python:3.10-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
COPY . /app
WORKDIR /app
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["timeout", "--signal=TERM", "--kill-after=15", "600", "sh", "deploy/railway-ci/run.sh"]
