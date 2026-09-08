#!/bin/sh
set -eu
cd /app
test -z "${GITHUB_TOKEN:-}${GH_TOKEN:-}${RAILWAY_TOKEN:-}${RAILWAY_API_TOKEN:-}"
printf '%s\n' "${RAILWAY_GIT_COMMIT_SHA:-}" | grep -Eq '^[0-9a-f]{40}$'
python3 -m unittest discover -s tests -v
node --test --test-reporter=spec web-tests/*.test.mjs
printf 'RAILWAY_CI_PASS source=%s deployment=%s\n' \
  "$RAILWAY_GIT_COMMIT_SHA" "${RAILWAY_DEPLOYMENT_ID:-unavailable}"
