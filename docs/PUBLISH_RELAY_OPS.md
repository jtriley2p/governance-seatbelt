# Publish Relay Ops

Operational reference for the managed publish relay used by `bun upload --publish`.

Audience: relay maintainers/operators. End-user publish steps are in `docs/PUBLISH_QUICKSTART.md`.

## Relay behavior

- Relay always re-validates artifacts server-side against the publish contract.
- Managed relay is the default publish path for end users.
- BYO Vercel remains an internal break-glass fallback.

## Project topology (recommended)

Use separate projects for each responsibility:

- `seatbelt-relay` — write/API path (`POST /api/v1/publishes`)
- `seatbelt-publish` — artifact deployments (`simulation-results.json`, `publish-metadata.json`)
- `seatbelt-viewer` — stable frontend report viewer URL

Share links should resolve to:

- `<viewerUrl>?artifact=<artifactUrl>`

## Endpoints

### `GET /api/v1/health`
Returns relay liveliness and basic in-memory state.

### `POST /api/v1/publishes`
Publishes a validated artifact to managed Vercel.

Request body (JSON):

```json
{
  "artifact": { "...": "simulation-results payload" },
  "artifactRaw": "optional raw JSON string",
  "publishMetadata": { "optional": "client metadata" },
  "provenance": { "optional": "client provenance" }
}
```

Notes:
- `artifact` is required unless `artifactRaw` is provided.
- `Idempotency-Key` header is optional. If omitted, relay uses computed `artifact_hash`.

Success response (`201`):

```json
{
  "publishId": "uuid",
  "idempotencyKey": "key",
  "artifactHash": "sha256",
  "deploymentUrl": "https://...vercel.app",
  "artifactUrl": "https://.../simulation-results.json",
  "metadataUrl": "https://.../publish-metadata.json",
  "viewerUrl": "https://...viewer.vercel.app/"
}
```

`viewerUrl` is included when `SEATBELT_VIEWER_URL` is configured on relay.

## Failure model

- Invalid JSON/schema/artifact contract => `400`
- Oversized payload => `413`
- Rate limit exceeded => `429` with `Retry-After`
- Idempotency key reused for a different artifact hash => `409`
- Vercel publish failure => `502`

## Required environment variables

Set these on the `seatbelt-relay` Vercel project (Production + Preview):

```bash
# Managed Vercel deploy credentials (artifact target project)
export SEATBELT_RELAY_VERCEL_TOKEN="<token>"
export SEATBELT_RELAY_VERCEL_PROJECT_ID="<seatbelt-publish-project-id>"
export SEATBELT_RELAY_VERCEL_ORG_ID="<team-or-user-id>"

# Canonical frontend viewer URL used in share links
export SEATBELT_VIEWER_URL="https://seatbelt-viewer.vercel.app"

# Optional aliases (fallbacks if primary names are not set)
export VERCEL_TOKEN="$SEATBELT_RELAY_VERCEL_TOKEN"
export VERCEL_PROJECT_ID="$SEATBELT_RELAY_VERCEL_PROJECT_ID"
export VERCEL_ORG_ID="$SEATBELT_RELAY_VERCEL_ORG_ID"
```

Important:
- `SEATBELT_VIEWER_URL` should point to a stable viewer app URL (project/domain dedicated to frontend).
- Do not point `SEATBELT_VIEWER_URL` at rotating artifact deployment aliases.

Optional tuning:

```bash
export PORT=8787
export SEATBELT_RELAY_MAX_BODY_BYTES=5242880
export SEATBELT_RELAY_RATE_LIMIT_ENABLED=true
export SEATBELT_RELAY_RATE_LIMIT_WINDOW_MS=60000
export SEATBELT_RELAY_RATE_LIMIT_MAX_REQUESTS=30
export SEATBELT_RELAY_VERSION="publish-relay"
```

`SEATBELT_RELAY_VERSION` is label-only for observability/logging. Changing its value does not change runtime behavior.

## Deploy relay runtime to Vercel (`seatbelt-relay`)

From the repository root:

```bash
# 1) link this repo checkout to the relay project
vercel link --yes --project seatbelt-relay

# 2) confirm env vars are present (or add if missing)
vercel env ls

# 3) deploy production
vercel deploy --yes --prod
```

Expected runtime wiring for this repo:
- Vercel Function entrypoint: `api/v1/[endpoint].ts`
- Relay request adapter: `relay/vercel-api-handler.ts`
- Vercel Deploy API publisher (no local CLI spawn): `relay/vercel-runtime-publisher.ts`

Post-deploy verification:

```bash
# 1) health
curl -sS https://seatbelt-relay-beta.vercel.app/api/v1/health | jq

# 2) publish smoke test (expect artifactUrl + viewerUrl)
curl -sS -X POST https://seatbelt-relay-beta.vercel.app/api/v1/publishes \
  -H 'content-type: application/json' \
  -H "idempotency-key: relay-smoke-test-$(date +%s)" \
  --data @<(jq -n --rawfile a frontend/public/simulation-results.json '{artifactRaw: $a}') | jq
```

If `viewerUrl` is missing in the publish response, verify `SEATBELT_VIEWER_URL` is set on the relay project and redeploy relay.

## Run locally

```bash
# 1) ensure vercel CLI is available on relay host
bun add -g vercel

# 2) run relay
bun run relay:start

# 3) health check
curl -s http://localhost:8787/api/v1/health | jq
```

Publish test request:

```bash
curl -s -X POST http://localhost:8787/api/v1/publishes \
  -H 'content-type: application/json' \
  -H 'idempotency-key: demo-key-1' \
  --data @<(jq -n --rawfile a frontend/public/simulation-results.json '{artifactRaw: $a}') | jq
```

## Break-glass fallback

For break-glass CLI fallback usage (`--publish-provider vercel`), see `docs/PUBLISH_QUICKSTART.md`.
