# Railway verification

The dedicated `market-brief-ci` service runs the Python 3.10 and Node 22
checks from `.github/workflows/tests.yml` on every main-branch push. Configure
`deploy/railway-ci/Dockerfile`, one replica, restart policy `NEVER`, and leave
Wait for CI disabled. No credentials or public endpoint are needed.

The process exits after testing and has a ten-minute deadline. Require the
`RAILWAY_CI_PASS` log marker for the exact source SHA and deployment; a built
container alone is not proof. GitHub Pages publication is a separate service
and is not replaced by this verification job.

## Pull requests

The same tests run during the image build, so a failed verification makes the
native Railway deployment check fail. Runtime logs still carry the exact source
and deployment completion marker. Neither build nor runtime receives publishing
or controller credentials.

The Railway `public-pr-ci` environment is the isolated PR base. It contains only
public test services, no shared secrets, volumes, or public domains. Focused PR
environments build the changed repository; bot PR environments are enabled.
Railway only creates previews for contributors associated with the workspace or
project, so the GitHub PR workflow runs only as fallback for non-owner contributors
until an equivalent external-fork executor is available.
