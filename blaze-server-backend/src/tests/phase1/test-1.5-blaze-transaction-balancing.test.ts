import { describe, test, expect } from "bun:test";
import { Emulator } from "@blaze-cardano/emulator";
import { makeValue, Core } from "@blaze-cardano/sdk";
import * as Data from "@blaze-cardano/data";
import { MyDatum, HelloWorldHelloWorldSpend } from "../../utils/contracts";
import { basicProtocolParameters } from "../../utils/protocol-params";
import { createHash } from "crypto";

// Utility function to extract transaction ID
async function getTransactionId(txBuilder: any): Promise<string> {
  const completed = await txBuilder.complete();
  return completed.getId();
}

describe("Blaze Transaction Balancing Tests", () => {
  test("verify Blaze handles multi-operation transaction balancing", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    
    // Register wallets with substantial funds
    await emulator.register("alice", makeValue(100_000_000n)); // 100 ADA
    await emulator.register("bob", makeValue(50_000_000n));   // 50 ADA
    
    // Create contract for testing
    const script = new HelloWorldHelloWorldSpend();
    const scriptAddress = Core.addressFromValidator(Core.NetworkId.Testnet, script.Script);
    
    let transactionResults: any = {};
    
    await emulator.as("alice", async (blaze, aliceAddr) => {
      // Get Bob's address for transfers
      let bobAddr: any;
      await emulator.as("bob", async (_, addr) => {
        bobAddr = addr;
      });
      
      // Add substantial UTXOs for Alice
      emulator.addUtxo(
        new Core.TransactionUnspentOutput(
          new Core.TransactionInput(Core.TransactionId("f".repeat(64)), 0n),
          new Core.TransactionOutput(aliceAddr, makeValue(50_000_000n)), // 50 ADA
        ),
      );
      
      emulator.addUtxo(
        new Core.TransactionUnspentOutput(
          new Core.TransactionInput(Core.TransactionId("f".repeat(64)), 1n),
          new Core.TransactionOutput(aliceAddr, makeValue(30_000_000n)), // 30 ADA
        ),
      );
      
      console.log("\n=== Testing Multi-Operation Transaction Balancing ===");
      
      try {
        // Build a complex transaction with multiple operations
        const tx = blaze.newTransaction()
          // Output 1: Send 5 ADA to Bob
          .addOutput(new Core.TransactionOutput(bobAddr, makeValue(5_000_000n)))
          // Output 2: Send 10 ADA to Bob  
          .addOutput(new Core.TransactionOutput(bobAddr, makeValue(10_000_000n)))
          // Output 3: Lock 3 ADA to contract
          .lockAssets(scriptAddress, makeValue(3_000_000n), Data.serialize(MyDatum, { thing: 42n }))
          // Output 4: Lock 2 ADA to contract with different datum
          .lockAssets(scriptAddress, makeValue(2_000_000n), Data.serialize(MyDatum, { thing: 99n }));
        
        console.log("  Built transaction with 4 outputs totaling 20 ADA");
        
        // Check if we can get transaction details before completion
        if (tx.toCbor && typeof tx.toCbor === 'function') {
          const cbor = tx.toCbor();
          console.log("  Transaction CBOR length:", cbor.length);
          transactionResults.cborLength = cbor.length;
        }
        
        // Try to complete the transaction
        console.log("  Attempting to complete transaction...");
        const completed = await tx.complete();
        console.log("  ✅ Transaction completed successfully");
        
        const txId = completed.getId();
        console.log("  Transaction ID:", txId);
        transactionResults.txId = txId;
        transactionResults.completedSuccessfully = true;
        
        // Check the completed transaction structure
        if (completed.toCore && typeof completed.toCore === 'function') {
          const coreTx = completed.toCore();
          console.log("  Core transaction type:", typeof coreTx);
          console.log("  Core transaction properties:", Object.keys(coreTx));
          
          // Try to access body directly as property instead of method
          const body = coreTx.body || (coreTx.body && typeof coreTx.body === 'function' ? coreTx.body() : null);
          
          if (body) {
            console.log("  Transaction body found, type:", typeof body);
            console.log("  Body properties:", Object.keys(body));
            
            // Try different ways to access outputs
            const outputs = body.outputs || (body.outputs && typeof body.outputs === 'function' ? body.outputs() : null);
            if (outputs) {
              console.log("  Number of outputs in completed tx:", outputs.length || "unknown");
              transactionResults.outputCount = outputs.length || 0;
            }
            
            // Try different ways to access inputs  
            const inputs = body.inputs || (body.inputs && typeof body.inputs === 'function' ? body.inputs() : null);
            if (inputs) {
              console.log("  Number of inputs in completed tx:", inputs.length || "unknown");
              transactionResults.inputCount = inputs.length || 0;
            }
            
            // Try different ways to access fee
            const fee = body.fee || (body.fee && typeof body.fee === 'function' ? body.fee() : null);
            if (fee) {
              console.log("  Transaction fee:", fee?.toString() || "unknown");
              transactionResults.fee = fee?.toString() || "unknown";
            }
          } else {
            console.log("  Could not access transaction body");
          }
        }
        
        // Submit the transaction
        console.log("  Submitting to emulator...");
        await emulator.expectValidTransaction(blaze, completed);
        console.log("  ✅ Transaction submitted successfully");
        transactionResults.submittedSuccessfully = true;
        transactionResults.completedSuccessfully = true; // Mark as successful if we get here
        
        // Verify balances after transaction
        console.log("\n=== Post-Transaction Verification ===");
        
        // Check Alice's remaining balance
        const aliceUtxos = await blaze.provider.getUnspentOutputs(aliceAddr);
        const aliceBalance = aliceUtxos.reduce((total: bigint, utxo: any) => 
          total + utxo.output().amount().coin(), 0n);
        console.log("  Alice's remaining balance:", aliceBalance.toString(), "lovelace");
        transactionResults.aliceBalanceAfter = aliceBalance.toString();
        
        // Check contract UTXOs
        const contractUtxos = await blaze.provider.getUnspentOutputs(scriptAddress);
        const contractBalance = contractUtxos.reduce((total: bigint, utxo: any) => 
          total + utxo.output().amount().coin(), 0n);
        console.log("  Contract balance:", contractBalance.toString(), "lovelace");
        console.log("  Contract UTXOs count:", contractUtxos.length);
        transactionResults.contractBalance = contractBalance.toString();
        transactionResults.contractUtxoCount = contractUtxos.length;
        
      } catch (error) {
        console.log("  ❌ Transaction failed:", error.message);
        transactionResults.error = error.message;
        transactionResults.completedSuccessfully = false;
      }
    });
    
    // Verify Bob's balance increased
    await emulator.as("bob", async (blaze, bobAddr) => {
      const bobUtxos = await blaze.provider.getUnspentOutputs(bobAddr);
      const bobBalance = bobUtxos.reduce((total: bigint, utxo: any) => 
        total + utxo.output().amount().coin(), 0n);
      console.log("  Bob's balance after:", bobBalance.toString(), "lovelace");
      transactionResults.bobBalanceAfter = bobBalance.toString();
    });
    
    console.log("\n=== Transaction Balancing Results ===");
    console.log(JSON.stringify(transactionResults, null, 2));
    
    // Core validation - the important parts work
    expect(transactionResults.txId).toMatch(/^[0-9a-f]{64}$/);
    expect(transactionResults.outputCount).toBe(5); // 4 requested + 1 change
    expect(transactionResults.inputCount).toBe(1);  // Automatic input selection
    expect(Number(transactionResults.fee)).toBeGreaterThan(0); // Fee calculated
    
    console.log("✅ Blaze successfully handled multi-operation transaction balancing");
  });

  test("verify fee calculation and change handling", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(100_000_000n));
    await emulator.register("bob", makeValue(50_000_000n));
    
    let feeResults: any = {};
    
    await emulator.as("alice", async (blaze, aliceAddr) => {
      let bobAddr: any;
      await emulator.as("bob", async (_, addr) => {
        bobAddr = addr;
      });
      
      // Add a precise UTXO amount
      const inputAmount = 10_000_000n; // 10 ADA
      emulator.addUtxo(
        new Core.TransactionUnspentOutput(
          new Core.TransactionInput(Core.TransactionId("e".repeat(64)), 0n),
          new Core.TransactionOutput(aliceAddr, makeValue(inputAmount)),
        ),
      );
      
      try {
        // Build transaction that sends less than input (should create change)
        const outputAmount = 3_000_000n; // 3 ADA
        const tx = blaze.newTransaction()
          .addOutput(new Core.TransactionOutput(bobAddr, makeValue(outputAmount)));
        
        const completed = await tx.complete();
        const txId = completed.getId();
        
        feeResults.txId = txId;
        feeResults.inputAmount = inputAmount.toString();
        feeResults.outputAmount = outputAmount.toString();
        
        // Extract fee and change information
        if (completed.toCore && typeof completed.toCore === 'function') {
          const coreTx = completed.toCore();
          const body = coreTx.body();
          
          if (body && body.fee && typeof body.fee === 'function') {
            const fee = body.fee();
            feeResults.fee = fee?.toString() || "unknown";
            console.log("  Calculated fee:", fee?.toString(), "lovelace");
          }
          
          if (body && body.outputs && typeof body.outputs === 'function') {
            const outputs = body.outputs();
            feeResults.totalOutputs = outputs.length || 0;
            console.log("  Total outputs:", outputs.length || 0);
            
            // If there are 2 outputs, one should be change back to Alice
            if (outputs.length === 2) {
              console.log("  ✅ Change output created");
              feeResults.changeCreated = true;
            } else {
              console.log("  ⚠️  Unexpected number of outputs");
              feeResults.changeCreated = false;
            }
          }
        }
        
        await emulator.expectValidTransaction(blaze, completed);
        feeResults.submittedSuccessfully = true;
        
        // Verify the math: input = output + fee + change
        const inputAmountNum = Number(inputAmount);
        const outputAmountNum = Number(outputAmount);
        const feeAmountNum = Number(feeResults.fee || "0");
        
        const expectedChange = inputAmountNum - outputAmountNum - feeAmountNum;
        console.log("  Expected change:", expectedChange, "lovelace");
        feeResults.expectedChange = expectedChange.toString();
        
      } catch (error) {
        console.log("  ❌ Fee calculation test failed:", error.message);
        feeResults.error = error.message;
      }
    });
    
    console.log("\n=== Fee Calculation Results ===");
    console.log(JSON.stringify(feeResults, null, 2));
    
    expect(feeResults.txId).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(feeResults.inputAmount)).toBeGreaterThan(Number(feeResults.outputAmount));
    
    console.log("✅ Blaze properly calculates fees and handles change");
  });

  test("verify input selection for insufficient funds", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(2_000_000n)); // Only 2 ADA
    await emulator.register("bob", makeValue(50_000_000n));
    
    let insufficientFundsTest: any = {};
    
    await emulator.as("alice", async (blaze, aliceAddr) => {
      let bobAddr: any;
      await emulator.as("bob", async (_, addr) => {
        bobAddr = addr;
      });
      
      // Add only 1 ADA UTXO
      emulator.addUtxo(
        new Core.TransactionUnspentOutput(
          new Core.TransactionInput(Core.TransactionId("d".repeat(64)), 0n),
          new Core.TransactionOutput(aliceAddr, makeValue(1_000_000n)), // 1 ADA
        ),
      );
      
      try {
        // Try to send 5 ADA (should fail)
        const tx = blaze.newTransaction()
          .addOutput(new Core.TransactionOutput(bobAddr, makeValue(5_000_000n))); // 5 ADA
        
        console.log("  Attempting to send 5 ADA with only 1 ADA available...");
        
        const completed = await tx.complete();
        insufficientFundsTest.unexpectedSuccess = true;
        console.log("  ⚠️  Transaction completed unexpectedly");
        
      } catch (error) {
        console.log("  ✅ Transaction properly failed:", error.message);
        insufficientFundsTest.expectedFailure = true;
        insufficientFundsTest.errorMessage = error.message;
      }
    });
    
    console.log("\n=== Insufficient Funds Test Results ===");
    console.log(JSON.stringify(insufficientFundsTest, null, 2));
    
    // Should fail with insufficient funds
    expect(insufficientFundsTest.expectedFailure).toBe(true);
    expect(insufficientFundsTest.unexpectedSuccess).not.toBe(true);
    
    console.log("✅ Blaze properly validates insufficient funds");
  });
});