/// Redeemer for v2 logic validators.
/// Normal: standard multisig-validated state change (wraps inner domain redeemer)
/// Migrate: one-time datum upgrade from v1 to v2, bypasses multisig, gated by logic_round
pub type LogicRedeemer {
  Normal(Data)
  Migrate
}
