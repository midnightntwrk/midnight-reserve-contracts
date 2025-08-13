import { describe, test, expect } from "bun:test";
import { Emulator } from "@blaze-cardano/emulator";
import { makeValue } from "@blaze-cardano/sdk";
import { basicProtocolParameters } from "../../src/utils/protocol-params";

describe("Time Advancement Performance", () => {
  test("measure real-time performance for 1 week advancement", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(1_000_000_000n)); // 1000 ADA
    
    console.log("\n=== 1 Week Time Advancement Performance Test ===");
    
    const WEEK_IN_SECONDS = 7 * 24 * 60 * 60; // 604,800 seconds
    const SLOTS_PER_TX = 20;
    const transactionsNeeded = Math.ceil(WEEK_IN_SECONDS / SLOTS_PER_TX);
    
    console.log("Target duration: 1 week (604,800 seconds)");
    console.log("Transactions needed:", transactionsNeeded);
    console.log("Expected slots advanced:", transactionsNeeded * SLOTS_PER_TX);
    
    const realTimeStart = Date.now();
    const initialSlot = emulator.clock.slot;
    
    await emulator.as("alice", async (blaze, addr) => {
      console.log("Starting empty transaction submission...");
      
      // Track progress every 1000 transactions
      for (let i = 0; i < transactionsNeeded; i++) {
        const emptyTx = blaze.newTransaction();
        await emulator.expectValidTransaction(blaze, emptyTx);
        
        if ((i + 1) % 1000 === 0 || i === 0) {
          const progressTime = Date.now();
          const elapsed = (progressTime - realTimeStart) / 1000;
          const progress = ((i + 1) / transactionsNeeded) * 100;
          const currentSlot = emulator.clock.slot;
          const slotsAdvanced = currentSlot - initialSlot;
          
          console.log(`Progress: ${(i + 1).toLocaleString()}/${transactionsNeeded.toLocaleString()} (${progress.toFixed(1)}%) - ${elapsed.toFixed(1)}s real time - ${slotsAdvanced} slots advanced`);
        }
      }
      
      const finalSlot = emulator.clock.slot;
      const realTimeEnd = Date.now();
      const realTimeElapsed = (realTimeEnd - realTimeStart) / 1000;
      const slotsAdvanced = finalSlot - initialSlot;
      const simulatedTimeAdvanced = slotsAdvanced; // 1 slot = 1 second
      
      console.log("\n=== Results ===");
      console.log("Real time elapsed:", realTimeElapsed.toFixed(2), "seconds");
      console.log("Simulated time advanced:", simulatedTimeAdvanced.toLocaleString(), "seconds");
      console.log("Simulated time advanced (hours):", (simulatedTimeAdvanced / 3600).toFixed(1));
      console.log("Simulated time advanced (days):", (simulatedTimeAdvanced / 86400).toFixed(2));
      console.log("Performance ratio:", (simulatedTimeAdvanced / realTimeElapsed).toFixed(0) + "x");
      console.log("Transactions per second:", (transactionsNeeded / realTimeElapsed).toFixed(1));
      
      expect(slotsAdvanced).toBeGreaterThanOrEqual(WEEK_IN_SECONDS);
    });
  }, 300000); // 5 minute timeout
  
  test("verify performance consistency across different time periods", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(1_000_000_000n));
    
    console.log("\n=== Performance Consistency Test ===");
    
    const testPeriods = [
      { name: "1 hour", seconds: 3600 },
      { name: "6 hours", seconds: 21600 },
      { name: "1 day", seconds: 86400 },
      { name: "2 days", seconds: 172800 },
      { name: "3 days", seconds: 259200 }
    ];
    
    const results: Array<{
      name: string;
      targetSeconds: number;
      transactions: number;
      realTimeSeconds: number;
      simulatedSeconds: number;
      txPerSecond: number;
      performanceRatio: number;
    }> = [];
    
    for (const period of testPeriods) {
      console.log(`\n--- Testing ${period.name} (${period.seconds.toLocaleString()}s) ---`);
      
      const SLOTS_PER_TX = 20;
      const transactions = Math.ceil(period.seconds / SLOTS_PER_TX);
      const realTimeStart = Date.now();
      const initialSlot = emulator.clock.slot;
      
      await emulator.as("alice", async (blaze, addr) => {
        for (let i = 0; i < transactions; i++) {
          const emptyTx = blaze.newTransaction();
          await emulator.expectValidTransaction(blaze, emptyTx);
        }
        
        const finalSlot = emulator.clock.slot;
        const realTimeEnd = Date.now();
        const realTimeElapsed = (realTimeEnd - realTimeStart) / 1000;
        const slotsAdvanced = finalSlot - initialSlot;
        
        const result = {
          name: period.name,
          targetSeconds: period.seconds,
          transactions,
          realTimeSeconds: realTimeElapsed,
          simulatedSeconds: slotsAdvanced,
          txPerSecond: transactions / realTimeElapsed,
          performanceRatio: slotsAdvanced / realTimeElapsed
        };
        
        results.push(result);
        
        console.log(`Real time: ${realTimeElapsed.toFixed(2)}s`);
        console.log(`Simulated time: ${slotsAdvanced.toLocaleString()}s`);
        console.log(`Tx/sec: ${result.txPerSecond.toFixed(1)}`);
        console.log(`Performance ratio: ${result.performanceRatio.toFixed(0)}x`);
      });
    }
    
    console.log("\n=== Performance Summary ===");
    console.log("Period\t\tTx/sec\t\tRatio\t\tVariation");
    
    const avgTxPerSec = results.reduce((sum, r) => sum + r.txPerSecond, 0) / results.length;
    const avgRatio = results.reduce((sum, r) => sum + r.performanceRatio, 0) / results.length;
    
    results.forEach(result => {
      const txVariation = ((result.txPerSecond - avgTxPerSec) / avgTxPerSec * 100);
      const ratioVariation = ((result.performanceRatio - avgRatio) / avgRatio * 100);
      
      console.log(`${result.name.padEnd(12)}\t${result.txPerSecond.toFixed(1)}\t\t${result.performanceRatio.toFixed(0)}x\t\t${txVariation.toFixed(1)}%/${ratioVariation.toFixed(1)}%`);
    });
    
    console.log(`\nAverage Tx/sec: ${avgTxPerSec.toFixed(1)}`);
    console.log(`Average Performance Ratio: ${avgRatio.toFixed(0)}x`);
    
    // Check consistency (should be within 20% variance)
    const txPerSecVariance = Math.max(...results.map(r => r.txPerSecond)) - Math.min(...results.map(r => r.txPerSecond));
    const txPerSecVariancePercent = (txPerSecVariance / avgTxPerSec) * 100;
    
    console.log(`\nConsistency Check:`);
    console.log(`Tx/sec variance: ${txPerSecVariancePercent.toFixed(1)}% (should be <20%)`);
    
    expect(txPerSecVariancePercent).toBeLessThan(20); // Performance should be consistent
    expect(results.length).toBe(testPeriods.length);
  }, 300000); // 5 minute timeout
  
  test("estimate 1 week advancement time with sampling", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(1_000_000_000n));
    
    console.log("\n=== 1 Week Estimation via Sampling ===");
    
    // Sample smaller amounts to estimate 1 week performance
    const sampleSizes = [100, 500, 1000]; // transactions
    const estimates: number[] = [];
    
    for (const sampleSize of sampleSizes) {
      console.log(`\n--- Sample: ${sampleSize} transactions ---`);
      
      const realTimeStart = Date.now();
      
      await emulator.as("alice", async (blaze, addr) => {
        for (let i = 0; i < sampleSize; i++) {
          const emptyTx = blaze.newTransaction();
          await emulator.expectValidTransaction(blaze, emptyTx);
        }
        
        const realTimeEnd = Date.now();
        const realTimeElapsed = (realTimeEnd - realTimeStart) / 1000;
        const txPerSecond = sampleSize / realTimeElapsed;
        
        // Estimate 1 week
        const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;
        const SLOTS_PER_TX = 20;
        const weekTransactions = Math.ceil(WEEK_IN_SECONDS / SLOTS_PER_TX);
        const estimatedWeekTime = weekTransactions / txPerSecond;
        
        estimates.push(estimatedWeekTime);
        
        console.log(`Sample performance: ${txPerSecond.toFixed(1)} tx/sec`);
        console.log(`Estimated 1 week time: ${estimatedWeekTime.toFixed(1)} seconds (${(estimatedWeekTime / 60).toFixed(1)} minutes)`);
      });
    }
    
    const avgEstimate = estimates.reduce((a, b) => a + b, 0) / estimates.length;
    console.log(`\n=== Final Estimate ===`);
    console.log(`Average estimated 1 week advancement time: ${avgEstimate.toFixed(1)} seconds`);
    console.log(`That's ${(avgEstimate / 60).toFixed(1)} minutes or ${(avgEstimate / 3600).toFixed(2)} hours`);
    
    expect(estimates.length).toBe(sampleSizes.length);
    expect(avgEstimate).toBeGreaterThan(0);
  });
});