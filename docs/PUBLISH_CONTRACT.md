# Publish Contract (`bun upload`)

This document defines the publish guardrails enforced by Seatbelt.

## Canonical artifact input

- Input file: `simulation-results.json`
- Source of truth: existing `proposalData` + `report.structuredReport` contract
- No new report schema is introduced by publish

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

## Publish metadata (minimal)

On successful validation, `bun upload` records:

- `publish_id`
- `published_at`
- `artifact_hash` (SHA-256 over artifact bytes)

Current log destination: `.seatbelt/publish-log.jsonl`

## Usage

For CLI commands, custom paths, and fallback guidance, see `docs/PUBLISH_QUICKSTART.md`.

See `docs/PUBLISH_RELAY_OPS.md` for relay API/runtime details.
