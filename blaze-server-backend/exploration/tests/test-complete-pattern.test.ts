import { describe, test, expect } from "bun:test";
import { Emulator } from "@blaze-cardano/emulator";
import { makeValue, Core } from "@blaze-cardano/sdk";
import { basicProtocolParameters } from "../../src/utils/protocol-params";

describe("Transaction Complete Pattern", () => {
  test("explore transaction builder complete() pattern", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(100_000_000n));
    
    let findings: any = {};
    
    await emulator.as("alice", async (blaze, addr) => {
      // Add UTXO for spending
      emulator.addUtxo(
        new Core.TransactionUnspentOutput(
          new Core.TransactionInput(Core.TransactionId("a".repeat(64)), 0n),
          new Core.TransactionOutput(addr, makeValue(500_000_000n)),
        ),
      );

      const output = new Core.TransactionOutput(addr, makeValue(1_000_000n));
      const txBuilder = blaze.newTransaction().addOutput(output);
      
      // Check what type of object txBuilder is
      findings.builderType = txBuilder.constructor.name;
      findings.builderPrototype = Object.getPrototypeOf(txBuilder).constructor.name;
      
      // Look for completion methods
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(txBuilder));
      findings.hasComplete = methods.includes('complete');
      findings.hasCompleteSync = methods.includes('completeSync');
      findings.hasBuild = methods.includes('build');
      findings.hasToCbor = methods.includes('toCbor');
      
      // Try to complete the transaction before submission
      try {
        if (txBuilder.complete && typeof txBuilder.complete === 'function') {
          console.log("\n  Attempting to complete transaction...");
          const completed = await txBuilder.complete();
          findings.completedSuccessfully = true;
          findings.completedType = typeof completed;
          findings.completedConstructor = completed?.constructor?.name;
          
          // Try to get transaction ID from completed transaction
          if (completed) {
            // Check methods on completed transaction
            const completedMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(completed));
            findings.completedHasId = completedMethods.includes('id');
            findings.completedHasGetId = completedMethods.includes('getId');
            findings.completedHasHash = completedMethods.includes('hash');
            findings.completedHasToCore = completedMethods.includes('toCore');
            findings.completedHasToCbor = completedMethods.includes('toCbor');
            
            // Try to get the transaction ID
            if (completed.id && typeof completed.id === 'function') {
              try {
                const txId = completed.id();
                findings.txIdFromId = txId?.toString();
                findings.txIdType = typeof txId;
              } catch (e) {
                findings.idError = e.message;
              }
            }
            
            // Try to convert to Core and get ID
            if (completed.toCore && typeof completed.toCore === 'function') {
              try {
                const coreTx = completed.toCore();
                findings.coreTransactionType = coreTx?.constructor?.name;
                
                // Try to get transaction ID from Core.Transaction
                if (coreTx && coreTx.getId && typeof coreTx.getId === 'function') {
                  const coreId = coreTx.getId();
                  findings.coreTransactionId = coreId?.toString();
                }
                
                // Try to hash the transaction body
                if (coreTx && coreTx.body && typeof coreTx.body === 'function') {
                  const body = coreTx.body();
                  findings.bodyType = body?.constructor?.name;
                  
                  // Try to hash the body
                  if (body && body.hash && typeof body.hash === 'function') {
                    const bodyHash = body.hash();
                    findings.bodyHash = bodyHash?.toString();
                  }
                }
              } catch (e) {
                findings.coreError = e.message;
              }
            }
            
            // Now submit the completed transaction
            console.log("  Submitting completed transaction...");
            const submitResult = await emulator.expectValidTransaction(blaze, completed);
            findings.submitResult = submitResult;
            findings.submitResultType = typeof submitResult;
          }
        } else {
          findings.completedSuccessfully = false;
          findings.reason = "No complete() method found";
        }
      } catch (error) {
        findings.completeError = error.message;
      }
    });
    
    console.log("\n=== Transaction Complete Pattern Findings ===");
    console.log(JSON.stringify(findings, null, 2));
    
    expect(findings).toBeDefined();
  });

  test("test direct transaction submission and ID extraction", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(100_000_000n));
    
    let transactionId: string | null = null;
    
    await emulator.as("alice", async (blaze, addr) => {
      // Add UTXO for spending
      emulator.addUtxo(
        new Core.TransactionUnspentOutput(
          new Core.TransactionInput(Core.TransactionId("b".repeat(64)), 0n),
          new Core.TransactionOutput(addr, makeValue(500_000_000n)),
        ),
      );

      const output = new Core.TransactionOutput(addr, makeValue(1_000_000n));
      const txBuilder = blaze.newTransaction().addOutput(output);
      
      // Try to get CBOR before submission
      if (txBuilder.toCbor && typeof txBuilder.toCbor === 'function') {
        try {
          const cbor = txBuilder.toCbor();
          console.log("\n  Transaction CBOR length:", cbor?.length);
          
          // Try to hash the CBOR to get transaction ID
          // Transaction ID is the hash of the transaction body
          // We might need to use crypto functions
          if (cbor) {
            // Import crypto functions if available
            try {
              const crypto = await import('crypto');
              const hash = crypto.createHash('blake2b256');
              hash.update(Buffer.from(cbor, 'hex'));
              const txHash = hash.digest('hex');
              console.log("  Calculated transaction hash:", txHash);
              transactionId = txHash;
            } catch (e) {
              console.log("  Crypto error:", e.message);
            }
          }
        } catch (e) {
          console.log("  CBOR error:", e.message);
        }
      }
      
      // Submit the transaction
      await emulator.expectValidTransaction(blaze, txBuilder);
    });
    
    console.log("\n=== Direct Submission Results ===");
    console.log("Transaction ID extracted:", transactionId);
    
    expect(true).toBe(true);
  });
});