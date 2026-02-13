# Seatbelt Phase 1C — Managed Publish Relay MVP

## Build Clean Scaffold

- **Mode:** C (build/ship MVP)
- **Invariants:**
  1. Publish only artifacts that pass existing `validatePublishArtifact`.
  2. Every accepted publish returns stable URLs for deployment + artifact + metadata.
  3. Existing CLI BYO Vercel path (`bun upload --publish`) remains unchanged.
- **Source of Truth (SoT):**
  - `utils/publish/artifact-validator.ts`
  - `utils/publish/publish-metadata.ts`
- **Failure model:**
  - Invalid JSON/schema/artifact contract => `400`.
  - Oversized payload => `413`.
  - Rate limit exceeded => `429` with `Retry-After`.
  - Idempotency key reused for a different artifact hash => `409`.
  - Vercel publish failure => `502`.
- **Observability (MVP):**
  - Health endpoint with config + in-memory idempotency stats.
  - Structured relay logs include `publish_id`, idempotency key, hash, deployment URL.

---

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
- Relay always re-validates server-side against existing Seatbelt publish contract.
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

---

## Required environment variables

Set these on the relay host:

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
export SEATBELT_RELAY_VERSION="phase1c-mvp"
```

---

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

---

## CLI default behavior

`bun upload --publish` now routes to the managed relay by default. No local Vercel token or project setup is required for end users.

### BYO Vercel (break-glass only)

The direct Vercel deploy path is retained as an internal fallback, not a user-facing option.
It is **not** documented in `--help` primary options or the main README publish section.

Use only when the managed relay is unavailable:

```bash
bun upload --publish --publish-provider vercel
```

Requires `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID` (or `SEATBELT_VERCEL_*` aliases).

### UX simplification rationale

Removing BYO-Vercel from the default user path eliminates:
- Token/project setup friction for every new user
- Dual-path documentation maintenance
- Confusion about which publish path to use

BYO-Vercel is kept in code as a break-glass escape hatch (relay outage, quota exhaustion).
If relay proves reliable, BYO-Vercel can be fully removed in a future cleanup pass.

---

## MVP limitations (explicit)

- Rate limiting + idempotency are in-memory, single-instance only.
- No durable database yet for audit/history.
- No auth layer for publish endpoint (intentional for anyone-can-publish MVP).
- Clear seam exists for future shared-store upgrade (Redis/Postgres) without changing API contract.
