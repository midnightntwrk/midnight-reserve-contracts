use cardano/transaction.{OutputReference, Transaction}

pub type MyDatum {
  thing: Int,
}

// PRD-compliant hello world: datum == redeemer
validator hello_world {
  spend(
    datum: Option<MyDatum>,
    redeemer: Int,
    _output_ref: OutputReference,
    _context: Transaction,
  ) {
    when datum is {
      None -> False
      Some(d) -> d.thing == redeemer
    }
  }

  else(_) {
    fail
  }
}
