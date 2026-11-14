use cardano/address.{Credential}

/// The datum of a node of the registration set (MIP 421). The fields a node keeps come
/// first, then the fields Deactivate clears (user decision, 11-14). `#""` in `next_crch` or
/// `next_pool` ends that list.
pub type Node {
  Head { next_crch: ByteArray, next_pool: ByteArray }
  /// A permissioned candidate's crch, created at initialization only.
  Reserved { crch: ByteArray, next_crch: ByteArray }
  Registration {
    active: Bool,
    crch: ByteArray,
    next_crch: ByteArray,
    pool_id: ByteArray,
    next_pool: ByteArray,
    owner: Credential,
    crch_signature: ByteArray,
    keys: Pairs<ByteArray, ByteArray>,
    signatures: Pairs<ByteArray, ByteArray>,
    reward_address: ByteArray,
    fixed_cost: Int,
    attributes: Pairs<ByteArray, Data>,
  }
}
