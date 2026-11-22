use aiken/crypto.{ScriptHash}
use cardano/assets.{PolicyId}

/// Redeemer for v2 logic validators.
/// Normal: standard multisig-validated state change (wraps inner domain redeemer)
/// Migrate: one-time datum upgrade from v1 to v2, bypasses multisig, gated by logic_round
pub type LogicRedeemer {
  Normal(Data)
  Migrate
}

/// The reserve forever NFT's datum after reserve_logic_v2's Init (PR 406).
/// Amounts are STAR.
pub type ReserveRewardState {
  curve_remaining_star: Int,
  cumulative_released_star: Int,
  next_interval_start_ms: Int,
  paused: Bool,
}

/// The withdraw redeemer of reserve_logic_v2.
pub type ReserveAction {
  /// Diagram 12
  Init
  /// Diagram 13
  Release
  /// Diagram 14
  Pause
  /// Diagram 15
  Unpause
}

/// The mint redeemer of reserve_logic_v2.
pub type InitTokenAction {
  /// Diagram 10
  MintInitTokens
  /// Diagram 12
  BurnInitToken
}

/// Diagram 11: the staging track reads these in place of the compiled hashes.
@list
pub type ReserveStagingParams {
  cnight_test_policy: PolicyId,
  forever_script_hash: ScriptHash,
  destination_hash: ScriptHash,
}
