# SIL-266 implementation plan

1. Confirm Vercel engine precedence and the existing broad constraint.
2. Set the docs engine to `22.x`, synchronize only lockfile root metadata, and align
   the README requirements. Do not modify dependencies or provisioning.
3. Verify a SHA-256-checked official Node 22 runtime, run `npm ci`, docs production
   build, lint, and internal-link check. Check the diff for dependency churn.
4. Obtain an independent clean-room review across the four repository review axes.
5. Publish a separate PR. Keep it open until internal review, Pullfrog, CodeRabbit,
   and CI satisfy the repository merge gates; record evidence on SIL-266.
