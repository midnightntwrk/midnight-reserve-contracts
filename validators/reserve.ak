use cardano/address.{Credential}
use cardano/assets.{PolicyId}
use cardano/certificate.{Certificate}
use cardano/governance.{ProposalProcedure, Voter}
use cardano/transaction.{OutputReference, Transaction}

validator forever_reserve {
  else(_ctx) {
    todo
  }
}

validator two_stage_upgrade_reserve {
  else(_ctx) {
    todo
  }
}
