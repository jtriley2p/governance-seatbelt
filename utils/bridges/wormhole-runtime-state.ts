// BNB's live Uniswap governance authority is a legacy Wormhole receiver that does not expose
// `EXPECTED_MESSAGE_PAYLOAD_VERSION`. This value is therefore a documented legacy assumption,
// supported by the Tenderly/manual rollout evidence gathered during issue #232 and follow-up
// issue #238. If that deployed receiver drifts, the dedicated BNB live validation should fail.
export const LEGACY_BNB_WORMHOLE_MESSAGE_PAYLOAD_VERSION =
  '0x5b9c8ce5e2cddf4e51d4563526c39850198bb92458f003423543f7bfae0ffb1b' as const;

// The same legacy BNB receiver stores `nextMinimumSequence` at storage slot 0 on the deployed
// authority contract instead of exposing `nextMinimumSequence()`. The dedicated BNB live
// validation checks that slot is still readable and parseable before we trust this layout.
export const LEGACY_BNB_WORMHOLE_NEXT_MINIMUM_SEQUENCE_SLOT =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const;
