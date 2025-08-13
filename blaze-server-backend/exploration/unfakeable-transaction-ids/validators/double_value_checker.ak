// Purpose: Test validator for detecting fake transaction IDs in the backend server
// 
// This validator is intentionally opaque to the server - it receives only compiled
// bytecode and cannot reasonably determine what validation logic it implements.
// 
// The validator checks if exactly 2 inputs are being spent from the script address
// and validates that one input's lovelace value is exactly double the other.
// This creates a scenario where the server MUST use real transaction IDs to track
// which UTXOs contain which values, otherwise it cannot predict which pairs of
// UTXOs will successfully validate.
//
// Used in test-3.1-unfakeable-transaction-ids.test.ts to prove the server
// is using real blockchain transaction IDs rather than maintaining a fake ledger.
//
// Test Strategy:
// 1. Deploy this contract to emulator (server sees only compiled bytecode)
// 2. Lock multiple UTXOs with random values, including some 2x pairs
// 3. Attempt to unlock various pairs using transaction IDs returned by server
// 4. Only mathematically correct pairs should validate
// 5. This proves server must have real UTXOs tracked by real transaction IDs

use cardano/transaction.{Input, OutputReference, Transaction}
use cardano/assets.{lovelace_of}

// Simple datum - we don't actually use it for validation logic
pub type Datum {
  placeholder: Int,
}

// No redeemer needed - validation is purely based on input values
pub type Redeemer {
  placeholder: Int,
}

validator double_value_checker {
  spend(
    _datum: Option<Datum>,
    _redeemer: Redeemer, 
    _output_ref: OutputReference,
    context: Transaction,
  ) {
    // Get all inputs to this transaction
    let Transaction { inputs, .. } = context
    
    // For this test, we'll require exactly 2 inputs total
    // In a real implementation, we'd filter by script address
    when inputs is {
      [input1, input2] -> {
        // Extract lovelace amounts from both inputs
        let value1 = get_lovelace_amount(input1)
        let value2 = get_lovelace_amount(input2)
        
        // Check if one is exactly double the other (either direction)
        // This is the hidden logic the server cannot easily determine
        (value1 == value2 * 2) || (value2 == value1 * 2)
      }
      _ -> False  // Wrong number of inputs (0, 1, or 3+)
    }
  }

  else(_) {
    fail
  }
}

// Helper function to extract lovelace from an input
pub fn get_lovelace_amount(input: Input) -> Int {
  // Extract the coin amount from the input's value using cardano/assets
  lovelace_of(input.output.value)
}