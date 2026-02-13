# Phase 1 Publish Contract (Vercel-first)

This document captures the publish guardrails used by `bun upload`.

## Canonical artifact input

- Input file: `simulation-results.json`
- Source of truth: existing `proposalData` + `report.structuredReport` contract
- No new report schema is introduced in Phase 1

## Hard-block required fields

`bun upload` blocks publish when any of these are missing/invalid:

- `report.structuredReport.metadata.schemaVersion === 1`
- `report.structuredReport.metadata.simulationType` in `new | proposed | executed`
- `report.structuredReport.metadata.proposalId`
- `report.structuredReport.metadata.governorAddress` (20-byte `0x` address)
- `report.structuredReport.metadata.chainId` (positive integer)
- `report.structuredReport.metadata.simulationBlockNumber` (base-10 string)
- `report.structuredReport.metadata.simulationTimestamp` (base-10 string)
- `report.structuredReport.metadata.proposalCreatedAtBlockNumber` (`base-10 string` or `"unknown"`)
- `report.structuredReport.metadata.proposalCreatedAtTimestamp` (`base-10 string` or `"unknown"`)
- if `simulationType === "executed"`, both:
  - `proposalExecutedAtBlockNumber`
  - `proposalExecutedAtTimestamp`
- `report.status` must match `report.structuredReport.status`
- proposal call arrays must be length-aligned (`targets`, `values`, `signatures`, `calldatas`)

## Phase 1 publish metadata (minimal)

On successful validation, `bun upload` records:

- `publish_id`
- `published_at`
- `artifact_hash` (SHA-256 over artifact bytes)

Current log destination: `.seatbelt/publish-log.jsonl`

## Phase 1C — Managed relay publish (current default)

`bun upload --publish` sends the validated artifact to the managed publish relay (zero local setup).

See `docs/PUBLISH_PHASE1C_RELAY_MVP.md` for relay API details and operational fallback guidance.

## Command shape

```bash
# Validate + metadata log only
bun upload --validate-only

# Validate + publish via managed relay (default, zero setup)
bun upload --publish

# Optional custom paths
bun upload --artifact frontend/public/simulation-results.json --log .seatbelt/publish-log.jsonl --publish
```

## BYO Vercel (break-glass fallback)

Direct Vercel deploy is available as an internal escape hatch when the managed relay is down:

```bash
bun upload --publish --publish-provider vercel
```

Requires `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID` (or `SEATBELT_VERCEL_*` aliases).
See `docs/PUBLISH_PHASE1C_RELAY_MVP.md` for details on break-glass usage.
