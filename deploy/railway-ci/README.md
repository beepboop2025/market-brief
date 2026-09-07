# Railway verification

The dedicated `market-brief-ci` service runs the Python 3.10 and Node 22
checks from `.github/workflows/tests.yml` on every main-branch push. Configure
`deploy/railway-ci/Dockerfile`, one replica, restart policy `NEVER`, and leave
Wait for CI disabled. No credentials or public endpoint are needed.

The process exits after testing and has a ten-minute deadline. Require the
`RAILWAY_CI_PASS` log marker for the exact source SHA and deployment; a built
container alone is not proof. GitHub Pages publication is a separate service
and is not replaced by this verification job.
