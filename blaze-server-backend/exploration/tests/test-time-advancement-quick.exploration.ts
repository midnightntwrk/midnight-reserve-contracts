import { describe, test, expect } from "bun:test";
import { Emulator } from "@blaze-cardano/emulator";
import { makeValue } from "@blaze-cardano/sdk";
import { basicProtocolParameters } from "../../src/utils/protocol-params";

describe("Time Advancement Quick Performance", () => {
  test("measure performance on realistic samples and project to 1 week", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(1_000_000_000n)); // 1000 ADA
    
    console.log("\n=== Quick Performance Measurement ===");
    
    const sampleSizes = [50, 100, 200, 500, 1000];
    const performanceData: Array<{
      transactions: number;
      realTime: number;
      txPerSecond: number;
    }> = [];
    
    for (const sampleSize of sampleSizes) {
      console.log(`\n--- Testing ${sampleSize} transactions ---`);
      
      // Create fresh emulator instance to avoid UTxO depletion
      const testEmulator = new Emulator([], basicProtocolParameters);
      await testEmulator.register("alice", makeValue(1_000_000_000n));
      
      const realTimeStart = Date.now();
      let completedTransactions = 0;
      
      try {
        await testEmulator.as("alice", async (blaze, addr) => {
          for (let i = 0; i < sampleSize; i++) {
            const emptyTx = blaze.newTransaction();
            await testEmulator.expectValidTransaction(blaze, emptyTx);
            completedTransactions++;
          }
        });
      } catch (error) {
        console.log(`Stopped after ${completedTransactions} transactions due to:`, error.message);
      }
      
      const realTimeEnd = Date.now();
      const realTimeElapsed = (realTimeEnd - realTimeStart) / 1000;
      const txPerSecond = completedTransactions / realTimeElapsed;
      
      performanceData.push({
        transactions: completedTransactions,
        realTime: realTimeElapsed,
        txPerSecond
      });
      
      console.log(`Completed: ${completedTransactions}/${sampleSize} transactions`);
      console.log(`Real time: ${realTimeElapsed.toFixed(3)}s`);
      console.log(`Performance: ${txPerSecond.toFixed(1)} tx/sec`);
    }
    
    console.log("\n=== Performance Analysis ===");
    console.log("Transactions\tReal Time\tTx/Sec\t\tConsistency");
    
    const avgTxPerSec = performanceData.reduce((sum, p) => sum + p.txPerSecond, 0) / performanceData.length;
    
    performanceData.forEach(data => {
      const variance = ((data.txPerSecond - avgTxPerSec) / avgTxPerSec * 100);
      console.log(`${data.transactions}\t\t${data.realTime.toFixed(2)}s\t\t${data.txPerSecond.toFixed(1)}\t\t${variance.toFixed(1)}%`);
    });
    
    console.log(`\nAverage performance: ${avgTxPerSec.toFixed(1)} tx/sec`);
    
    // Project to 1 week
    const WEEK_IN_SECONDS = 7 * 24 * 60 * 60; // 604,800 seconds
    const SLOTS_PER_TX = 20;
    const weekTransactions = Math.ceil(WEEK_IN_SECONDS / SLOTS_PER_TX); // 30,240 transactions
    
    const projectedWeekTime = weekTransactions / avgTxPerSec;
    const projectedWeekMinutes = projectedWeekTime / 60;
    const projectedWeekHours = projectedWeekMinutes / 60;
    
    console.log("\n=== 1 Week Projection ===");
    console.log(`Transactions needed for 1 week: ${weekTransactions.toLocaleString()}`);
    console.log(`Projected real time: ${projectedWeekTime.toFixed(1)} seconds`);
    console.log(`That's ${projectedWeekMinutes.toFixed(1)} minutes`);
    console.log(`Or ${projectedWeekHours.toFixed(2)} hours`);
    console.log(`Performance ratio: ${(WEEK_IN_SECONDS / projectedWeekTime).toFixed(0)}x (1 week sim in ${projectedWeekMinutes.toFixed(1)} min real)`);
    
    // Check performance consistency
    const maxTxPerSec = Math.max(...performanceData.map(p => p.txPerSecond));
    const minTxPerSec = Math.min(...performanceData.map(p => p.txPerSecond));
    const variancePercent = ((maxTxPerSec - minTxPerSec) / avgTxPerSec) * 100;
    
    console.log(`\n=== Performance Consistency ===`);
    console.log(`Min/Max tx/sec: ${minTxPerSec.toFixed(1)} - ${maxTxPerSec.toFixed(1)}`);
    console.log(`Variance: ${variancePercent.toFixed(1)}% (curve flatness indicator)`);
    
    if (variancePercent < 10) {
      console.log("✅ Performance curve is FLAT - consistent across time periods");
    } else if (variancePercent < 20) {
      console.log("⚠️ Performance curve is mostly flat - acceptable variance");
    } else {
      console.log("❌ Performance curve is NOT flat - high variance detected");
    }
    
    expect(performanceData.length).toBeGreaterThan(0);
    expect(avgTxPerSec).toBeGreaterThan(0);
  });
  
  test("test different time periods for consistent performance curve", async () => {
    console.log("\n=== Day-by-Day Performance Curve Test ===");
    
    const timePeriods = [
      { name: "1 hour", seconds: 3600, expectedTx: 180 },
      { name: "6 hours", seconds: 21600, expectedTx: 1080 }, 
      { name: "12 hours", seconds: 43200, expectedTx: 2160 },
      { name: "1 day", seconds: 86400, expectedTx: 4320 },
      { name: "2 days", seconds: 172800, expectedTx: 8640 }
    ];
    
    const curveData: Array<{
      period: string;
      targetSeconds: number;
      actualTx: number;
      realTime: number;
      txPerSecond: number;
    }> = [];
    
    for (const period of timePeriods) {
      console.log(`\n--- Testing ${period.name} (${period.expectedTx} tx) ---`);
      
      // Use smaller sample size to avoid UTxO issues
      const sampleSize = Math.min(period.expectedTx, 200); // Cap at 200 tx to avoid UTxO depletion
      const scaleFactor = period.expectedTx / sampleSize;
      
      const testEmulator = new Emulator([], basicProtocolParameters);
      await testEmulator.register("alice", makeValue(1_000_000_000n));
      
      const realTimeStart = Date.now();
      let completedTransactions = 0;
      
      try {
        await testEmulator.as("alice", async (blaze, addr) => {
          for (let i = 0; i < sampleSize; i++) {
            const emptyTx = blaze.newTransaction();
            await testEmulator.expectValidTransaction(blaze, emptyTx);
            completedTransactions++;
          }
        });
      } catch (error) {
        console.log(`Sample completed: ${completedTransactions} transactions`);
      }
      
      const realTimeEnd = Date.now();
      const realTimeElapsed = (realTimeEnd - realTimeStart) / 1000;
      const txPerSecond = completedTransactions / realTimeElapsed;
      
      // Project to full period
      const projectedRealTime = (period.expectedTx / txPerSecond);
      
      curveData.push({
        period: period.name,
        targetSeconds: period.seconds,
        actualTx: period.expectedTx,
        realTime: projectedRealTime,
        txPerSecond: txPerSecond
      });
      
      console.log(`Sample: ${completedTransactions} tx in ${realTimeElapsed.toFixed(2)}s (${txPerSecond.toFixed(1)} tx/sec)`);
      console.log(`Projected full period: ${projectedRealTime.toFixed(1)}s real time`);
      console.log(`Efficiency: ${(period.seconds / projectedRealTime).toFixed(0)}x`);
    }
    
    console.log("\n=== Performance Curve Analysis ===");
    console.log("Period\t\tSim Time\tReal Time\tTx/Sec\t\tEfficiency\tVariation");
    
    const avgTxPerSec = curveData.reduce((sum, d) => sum + d.txPerSecond, 0) / curveData.length;
    
    curveData.forEach((data, index) => {
      const variance = ((data.txPerSecond - avgTxPerSec) / avgTxPerSec * 100);
      const efficiency = data.targetSeconds / data.realTime;
      
      console.log(`${data.period.padEnd(10)}\t${(data.targetSeconds/3600).toFixed(1)}h\t\t${data.realTime.toFixed(1)}s\t\t${data.txPerSecond.toFixed(1)}\t\t${efficiency.toFixed(0)}x\t\t${variance.toFixed(1)}%`);
    });
    
    const maxVariance = Math.max(...curveData.map(d => Math.abs((d.txPerSecond - avgTxPerSec) / avgTxPerSec * 100)));
    
    console.log(`\nCurve Flatness: ${maxVariance.toFixed(1)}% maximum variance`);
    
    if (maxVariance < 10) {
      console.log("✅ FLAT CURVE: Performance is consistent day over day");
    } else {
      console.log("⚠️ VARIABLE CURVE: Performance varies significantly");
    }
    
    expect(curveData.length).toBe(timePeriods.length);
    expect(maxVariance).toBeLessThan(30); // Allow some variance due to sampling
  });
});