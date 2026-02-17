# Publish Quickstart (`bun upload`)

This is the primary guide for publishing Seatbelt simulation artifacts.

## 1) Happy path (default managed relay)

No local Vercel setup is required.

```bash
# Validate artifact only (no publish)
bun upload --validate-only

# Validate + publish via managed relay (default)
bun upload --publish
```

On success, Seatbelt publishes a viewer deployment and returns URLs where:

- `/` renders the Seatbelt report viewer
- `/simulation-results.json` serves the artifact JSON
- `/publish-metadata.json` serves publish metadata

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

### `400` from publish endpoint
Artifact failed contract validation.

- Re-run `bun upload --validate-only`
- Ensure required publish fields are present (see `docs/PUBLISH_PHASE1.md`)

### `429` from relay
Rate limit exceeded.

- Wait for the `Retry-After` window and retry
- Avoid parallel publish spam from the same source

### `502` from relay
Relay could not complete provider publish (typically transient upstream/deploy issue).

- Retry once or twice with short backoff
- If persistent, check relay health (`GET /api/v1/health`) and provider status

## 5) Break-glass fallback (internal)

If the managed relay is unavailable, use direct Vercel publish:

```bash
bun upload --publish --publish-provider vercel
```

Requires Vercel credentials in env (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`, or `SEATBELT_VERCEL_*`).

---

## Related docs

- `docs/PUBLISH_PHASE1.md` — publish contract and required fields
- `docs/PUBLISH_PHASE1C_RELAY_MVP.md` — relay API/runtime/deploy details
