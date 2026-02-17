# Publish Relay Ops

Operational reference for the managed publish relay used by `bun upload --publish`.

## Relay behavior

- Relay always re-validates artifacts server-side against the publish contract.
- Managed relay is the default publish path for end users.
- BYO Vercel remains an internal break-glass fallback.

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
  "metadataUrl": "https://.../publish-metadata.json"
}
```

## Failure model

- Invalid JSON/schema/artifact contract => `400`
- Oversized payload => `413`
- Rate limit exceeded => `429` with `Retry-After`
- Idempotency key reused for a different artifact hash => `409`
- Vercel publish failure => `502`

## Required environment variables

Set these on the `seatbelt-relay` Vercel project (Production + Preview):

```bash
# Managed Vercel deploy credentials (primary names)
export SEATBELT_RELAY_VERCEL_TOKEN="<token>"
export SEATBELT_RELAY_VERCEL_PROJECT_ID="<project-id>"
export SEATBELT_RELAY_VERCEL_ORG_ID="<team-or-user-id>"

# Optional aliases (fallbacks if primary names are not set)
export VERCEL_TOKEN="$SEATBELT_RELAY_VERCEL_TOKEN"
export VERCEL_PROJECT_ID="$SEATBELT_RELAY_VERCEL_PROJECT_ID"
export VERCEL_ORG_ID="$SEATBELT_RELAY_VERCEL_ORG_ID"
```

Optional tuning:

```bash
export PORT=8787
export SEATBELT_RELAY_MAX_BODY_BYTES=5242880
export SEATBELT_RELAY_RATE_LIMIT_ENABLED=true
export SEATBELT_RELAY_RATE_LIMIT_WINDOW_MS=60000
export SEATBELT_RELAY_RATE_LIMIT_MAX_REQUESTS=30
export SEATBELT_RELAY_VERSION="publish-relay"
```

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
curl -sS https://seatbelt-relay-beta.vercel.app/api/v1/health | jq
```

If you need to verify publish end-to-end with a known-good artifact:

```bash
curl -sS -X POST https://seatbelt-relay-beta.vercel.app/api/v1/publishes \
  -H 'content-type: application/json' \
  -H 'idempotency-key: relay-smoke-test-1' \
  --data @<(jq -n --rawfile a frontend/public/simulation-results.json '{artifactRaw: $a}') | jq
```

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

Use only when the managed relay is unavailable:

```bash
bun upload --publish --publish-provider vercel
```

Requires `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID` (or `SEATBELT_VERCEL_*` aliases).
