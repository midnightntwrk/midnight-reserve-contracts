import { describe, test, expect } from "bun:test";
import { Emulator } from "@blaze-cardano/emulator";
import { makeValue } from "@blaze-cardano/sdk";
import { basicProtocolParameters } from "../../src/utils/protocol-params";

describe("Efficient Time Advancement", () => {
  test("find most efficient way to advance specific time durations", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(100_000_000n));
    
    console.log("\n=== Testing Different Time Advancement Strategies ===");
    
    await emulator.as("alice", async (blaze, addr) => {
      const startSlot = emulator.clock.slot;
      console.log("Starting slot:", startSlot);
      
      // Strategy 1: Minimal self-transfer
      console.log("\n--- Strategy 1: Minimal Self-Transfer ---");
      const tx1 = blaze.newTransaction()
        .payLovelace(addr, 1n); // Send 1 lovelace to self
      
      await emulator.expectValidTransaction(blaze, tx1);
      const afterMinimal = emulator.clock.slot;
      const minimalAdvancement = afterMinimal - startSlot;
      console.log("Slots advanced with 1 lovelace transfer:", minimalAdvancement);
      
      // Strategy 2: Empty transaction (if possible)
      console.log("\n--- Strategy 2: Try Empty Transaction ---");
      try {
        const emptyTx = blaze.newTransaction();
        const completed = await emptyTx.complete();
        console.log("Empty transaction completed successfully");
        
        await emulator.expectValidTransaction(blaze, emptyTx);
        const afterEmpty = emulator.clock.slot;
        const emptyAdvancement = afterEmpty - afterMinimal;
        console.log("Slots advanced with empty transaction:", emptyAdvancement);
      } catch (error) {
        console.log("Empty transaction failed:", error.message);
      }
      
      // Strategy 3: Metadata-only transaction
      console.log("\n--- Strategy 3: Metadata-Only Transaction ---");
      try {
        const metadataTx = blaze.newTransaction()
          .addAuxiliaryData({ 
            metadata: new Map([[1n, "time-advance"]])
          });
        
        await emulator.expectValidTransaction(blaze, metadataTx);
        const afterMetadata = emulator.clock.slot;
        const metadataAdvancement = afterMetadata - (emulator.clock.slot - minimalAdvancement);
        console.log("Slots advanced with metadata transaction:", metadataAdvancement);
      } catch (error) {
        console.log("Metadata transaction failed:", error.message);
      }
      
      // Strategy 4: Multiple small transactions in batch
      console.log("\n--- Strategy 4: Batch Small Transactions ---");
      const batchStart = emulator.clock.slot;
      const batchSize = 5;
      
      for (let i = 0; i < batchSize; i++) {
        const batchTx = blaze.newTransaction()
          .payLovelace(addr, 1n);
        await emulator.expectValidTransaction(blaze, batchTx);
      }
      
      const batchEnd = emulator.clock.slot;
      const batchAdvancement = batchEnd - batchStart;
      const avgPerTx = batchAdvancement / batchSize;
      console.log(`Batch of ${batchSize} transactions advanced ${batchAdvancement} slots (${avgPerTx} per tx)`);
      
      console.log("\n=== Time Advancement Analysis ===");
      console.log("Slot length:", emulator.clock.slotLength, "ms");
      console.log("Average slots per transaction:", avgPerTx);
      console.log("Time per transaction:", avgPerTx * emulator.clock.slotLength, "ms");
      
      // Calculate efficiency for different time targets
      console.log("\n=== Efficiency Calculations ===");
      const targets = [
        { name: "1 minute", seconds: 60 },
        { name: "5 minutes", seconds: 300 },
        { name: "1 hour", seconds: 3600 },
        { name: "1 day", seconds: 86400 }
      ];
      
      targets.forEach(target => {
        const slotsNeeded = target.seconds; // 1 slot = 1 second
        const txsNeeded = Math.ceil(slotsNeeded / avgPerTx);
        console.log(`${target.name}: ${slotsNeeded} slots needed, ~${txsNeeded} transactions required`);
      });
    });
    
    expect(true).toBe(true);
  });
  
  test("test time advancement precision and consistency", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(100_000_000n));
    
    console.log("\n=== Time Advancement Consistency Test ===");
    
    const results: number[] = [];
    
    await emulator.as("alice", async (blaze, addr) => {
      // Run multiple identical transactions to see consistency
      for (let i = 0; i < 10; i++) {
        const beforeSlot = emulator.clock.slot;
        
        const tx = blaze.newTransaction()
          .payLovelace(addr, 1n);
        
        await emulator.expectValidTransaction(blaze, tx);
        
        const afterSlot = emulator.clock.slot;
        const advancement = afterSlot - beforeSlot;
        results.push(advancement);
        
        console.log(`Transaction ${i + 1}: advanced ${advancement} slots`);
      }
      
      const avg = results.reduce((a, b) => a + b, 0) / results.length;
      const min = Math.min(...results);
      const max = Math.max(...results);
      
      console.log("\n=== Consistency Analysis ===");
      console.log("Average advancement:", avg, "slots");
      console.log("Min advancement:", min, "slots");
      console.log("Max advancement:", max, "slots");
      console.log("Variance:", max - min, "slots");
      console.log("Coefficient of variation:", ((max - min) / avg * 100).toFixed(2) + "%");
    });
    
    expect(results.length).toBe(10);
    expect(results.every(r => r > 0)).toBe(true);
  });
});