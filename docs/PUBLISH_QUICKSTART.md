# Publish Quickstart (`bun upload`)

This is the primary guide for publishing Seatbelt simulation artifacts.

## Prerequisites

Generate an artifact first:

```bash
SIM_NAME=my-proposal bun start
```

This writes `frontend/public/simulation-results.json` by default.

## 1) Happy path (default managed relay)

No local Vercel setup is required.

```bash
# Validate artifact only (no publish)
bun upload --validate-only

# Validate + publish via managed relay (default)
bun upload --publish
```

On success, the relay returns publish URLs:

- `deploymentUrl` — artifact deployment root (may be a publish landing page)
- `artifactUrl` — published `simulation-results.json` (branded alias when available, deployment URL fallback)
- `metadataUrl` — published `publish-metadata.json`
- `viewerUrl` — canonical frontend viewer URL (when relay is configured with `SEATBELT_VIEWER_URL`)

Canonical share links should use:

- `<viewerUrl>?artifact=<artifactUrl>`

## 2) Optional custom paths

```bash
bun upload \
  --artifact frontend/public/simulation-results.json \
  --log .seatbelt/publish-log.jsonl \
  --publish
```

## 3) Override relay endpoint (local/dev)

```bash
# via flag
bun upload --publish --relay-url http://localhost:8787

# via env var
SEATBELT_RELAY_URL=http://localhost:8787 bun upload --publish
```

## 4) Troubleshooting

### Share link opens artifact landing page instead of frontend viewer
Relay is not configured with a stable viewer URL.

- Set `SEATBELT_VIEWER_URL` on the `seatbelt-relay` project to your dedicated viewer app URL.
- Redeploy relay (`vercel deploy --yes --prod`).
- Re-run publish and confirm `viewerUrl` is present in relay response.

### `400` from publish endpoint
Artifact failed contract validation.

- Re-run `bun upload --validate-only`
- Ensure required publish fields are present (see `docs/PUBLISH_CONTRACT.md`)

### `429` from relay
Rate limit exceeded.

- Wait for the `Retry-After` window and retry
- Avoid parallel publish spam from the same source

### `413` from relay
Artifact payload exceeds relay max body size.

- Reduce payload size and retry
- If needed, ask relay operators to review `SEATBELT_RELAY_MAX_BODY_BYTES` (see `docs/PUBLISH_RELAY_OPS.md`)

### `502` from relay
Relay could not complete provider publish (typically transient upstream/deploy issue).

- Retry once or twice with short backoff
- If persistent, check relay health (`GET /api/v1/health`) and provider status

## 5) Break-glass fallback (internal)

If the managed relay is unavailable, use direct Vercel publish:

```bash
bun upload --publish --publish-provider vercel
```

Requires direct-publish credentials in env (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`, or `SEATBELT_VERCEL_*`).

Note: these are distinct from relay-operator credentials (`SEATBELT_RELAY_VERCEL_*`) documented in `docs/PUBLISH_RELAY_OPS.md`.

---

## Related docs

- `docs/PUBLISH_CONTRACT.md` — publish contract and required fields
- `docs/PUBLISH_RELAY_OPS.md` — relay API/runtime/deploy details
