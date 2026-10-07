# Scheduling Overnight with GitHub Actions

`overnight-digest.yml` runs the digest every morning (13:00 UTC = 06:00 PT) and on demand, then commits the HTML/JSON
archive and run state to an `overnight-archive` branch.

**Run it from a private repository you own.** A digest summarises private repositories, CI and deploys. The
workflow refuses to run in a public repository, and it never writes to ysta32/fleet. It only checks Fleet out to
build the CLI.

1. Create a private repo, e.g. `<you>/overnight-archive`.
2. Copy `overnight-digest.yml` to `.github/workflows/` in that repo.
3. Add secrets: `OVERNIGHT_GITHUB_TOKEN` (a fine-grained PAT with read-only access to your repos: Contents,
   Metadata, Pull requests, Issues, Actions), plus optional `ANTHROPIC_API_KEY`, `VERCEL_TOKEN`, `NOTION_TOKEN`,
   `RESEND_API_KEY` and `NTFY_TOKEN`.
4. Optional variables: `OVERNIGHT_OWNER` (defaults to the repo owner), `OVERNIGHT_SITE_URL`, `OVERNIGHT_NTFY_TOPIC`,
   `OVERNIGHT_NOTION_DATABASE_ID`, `OVERNIGHT_EMAIL_TO`, `OVERNIGHT_EMAIL_FROM`, and `OVERNIGHT_FLEET_REF` (a Fleet
   branch or tag to build from, default `main`).
5. Run it once from the Actions tab with **Run workflow**.

The job is skipped quietly when `OVERNIGHT_GITHUB_TOKEN` isn't set.
