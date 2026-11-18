use cardano/address.{Credential}

/// The datum of a node of the registration set (MIP 421). Each link names the node before
/// its own, `#""` on the first node of a list; the Tail is the last node of both lists. The
/// fields a node keeps come first, then the fields Deactivate clears (user decision, 11-14).
pub type Node {
  Tail { prev_crch: ByteArray, prev_pool: ByteArray }
  /// A permissioned candidate's crch, created at initialization only.
  Reserved { crch: ByteArray, prev_crch: ByteArray }
  Registration {
    active: Bool,
    crch: ByteArray,
    prev_crch: ByteArray,
    pool_id: ByteArray,
    prev_pool: ByteArray,
    owner: Credential,
    crch_signature: ByteArray,
    keys: Pairs<ByteArray, ByteArray>,
    signatures: Pairs<ByteArray, ByteArray>,
    reward_address: ByteArray,
    fixed_cost: Int,
    attributes: Pairs<ByteArray, Data>,
  }
}

/// The redeemer of night_registration's withdrawal, which checks every transaction at the
/// set: the action, each with one transaction shape (user decision, 11-17). The mint and the
/// spends read no redeemer.
pub type RegistrationAction {
  Init
  CreateTwoAnchors
  CreateOneAnchor
  Update
  Deactivate
}
