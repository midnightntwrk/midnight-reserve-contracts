import { describe, test, expect } from "bun:test";
import { Emulator } from "@blaze-cardano/emulator";
import { makeValue, Core } from "@blaze-cardano/sdk";
import * as Data from "@blaze-cardano/data";
import { MyDatum, HelloWorldHelloWorldSpend } from "../../utils/contracts";
import { basicProtocolParameters } from "../../utils/protocol-params";

describe("Transaction Hash Exploration", () => {
  test("explore expectValidTransaction return value", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(100_000_000n));
    
    let txResult: any = null;
    
    await emulator.as("alice", async (blaze, addr) => {
      // Add UTXO for spending
      emulator.addUtxo(
        new Core.TransactionUnspentOutput(
          new Core.TransactionInput(Core.TransactionId("1".repeat(64)), 0n),
          new Core.TransactionOutput(addr, makeValue(500_000_000n)),
        ),
      );

      const output = new Core.TransactionOutput(addr, makeValue(1_000_000n));
      const txBuilder = blaze.newTransaction().addOutput(output);
      
      txResult = await emulator.expectValidTransaction(blaze, txBuilder);
    });
    
    console.log("\n=== expectValidTransaction Result ===");
    console.log("Type:", typeof txResult);
    console.log("Value:", txResult);
    if (txResult && typeof txResult === 'object') {
      console.log("Properties:", Object.keys(txResult));
      console.log("Constructor:", txResult.constructor?.name);
    }
    
    expect(true).toBe(true); // Just to make test pass
  });

  test("explore transaction complete() method", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(100_000_000n));
    
    let transactionInfo: any = {};
    
    await emulator.as("alice", async (blaze, addr) => {
      emulator.addUtxo(
        new Core.TransactionUnspentOutput(
          new Core.TransactionInput(Core.TransactionId("2".repeat(64)), 0n),
          new Core.TransactionOutput(addr, makeValue(500_000_000n)),
        ),
      );

      const output = new Core.TransactionOutput(addr, makeValue(1_000_000n));
      const txBuilder = blaze.newTransaction().addOutput(output);
      
      // Check txBuilder methods
      const builderMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(txBuilder));
      transactionInfo.hasComplete = builderMethods.includes('complete');
      transactionInfo.builderMethods = builderMethods.filter(m => 
        m.includes('complete') || m.includes('build') || m.includes('id') || m.includes('hash')
      );
      
      if (txBuilder.complete && typeof txBuilder.complete === 'function') {
        const completed = await txBuilder.complete();
        transactionInfo.completedType = typeof completed;
        transactionInfo.completedConstructor = completed?.constructor?.name;
        
        if (completed) {
          const completedMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(completed));
          transactionInfo.completedMethods = completedMethods.filter(m => 
            m.includes('id') || m.includes('hash') || m.includes('Id') || m.includes('Hash')
          );
          
          // Try to get transaction ID/hash
          if (completed.getId && typeof completed.getId === 'function') {
            try {
              transactionInfo.txIdFromGetId = completed.getId();
            } catch (e) {
              transactionInfo.getIdError = e.message;
            }
          }
          
          if (completed.id && typeof completed.id === 'function') {
            try {
              transactionInfo.txIdFromId = completed.id();
            } catch (e) {
              transactionInfo.idError = e.message;
            }
          }
          
          if (completed.hash && typeof completed.hash === 'function') {
            try {
              transactionInfo.txHashFromHash = completed.hash();
            } catch (e) {
              transactionInfo.hashError = e.message;
            }
          }
          
          // Check for toCore
          if (completed.toCore && typeof completed.toCore === 'function') {
            try {
              const coreTx = completed.toCore();
              transactionInfo.coreType = typeof coreTx;
              transactionInfo.coreConstructor = coreTx?.constructor?.name;
              
              if (coreTx && coreTx.getId && typeof coreTx.getId === 'function') {
                transactionInfo.coreTxId = coreTx.getId();
              }
            } catch (e) {
              transactionInfo.coreError = e.message;
            }
          }
          
          // Submit the completed transaction (don't try to call complete() again)
          try {
            const submitResult = await emulator.expectValidTransaction(blaze, completed);
            transactionInfo.submitResult = submitResult;
            transactionInfo.submitResultType = typeof submitResult;
          } catch (e) {
            transactionInfo.submitError = e.message;
          }
        }
      }
    });
    
    console.log("\n=== Transaction complete() Exploration ===");
    console.log(JSON.stringify(transactionInfo, null, 2));
    
    expect(true).toBe(true);
  });

  test("explore emulator internal state", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    
    console.log("\n=== Emulator Internal State ===");
    console.log("Emulator properties:", Object.keys(emulator));
    
    // Check for any transaction tracking
    const emulatorAny = emulator as any;
    if (emulatorAny.ledger) {
      console.log("Ledger exists:", true);
      console.log("Ledger type:", typeof emulatorAny.ledger);
      console.log("Ledger properties:", Object.keys(emulatorAny.ledger));
      
      if (emulatorAny.ledger.transactions) {
        console.log("Ledger has transactions:", true);
      }
    }
    
    if (emulatorAny.mempool) {
      console.log("Mempool exists:", true);
      console.log("Mempool type:", typeof emulatorAny.mempool);
      console.log("Mempool properties:", Object.keys(emulatorAny.mempool));
    }
    
    if (emulatorAny.chain) {
      console.log("Chain exists:", true);
      console.log("Chain type:", typeof emulatorAny.chain);
      console.log("Chain properties:", Object.keys(emulatorAny.chain));
    }
    
    expect(true).toBe(true);
  });

  test("explore provider methods", async () => {
    const emulator = new Emulator([], basicProtocolParameters);
    await emulator.register("alice", makeValue(100_000_000n));
    
    let providerInfo: any = {};
    
    await emulator.as("alice", async (blaze, addr) => {
      const provider = blaze.provider;
      providerInfo.type = provider.constructor.name;
      
      const allMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(provider));
      providerInfo.transactionMethods = allMethods.filter(m => 
        m.toLowerCase().includes('transaction') || 
        m.toLowerCase().includes('tx')
      );
      providerInfo.submitMethods = allMethods.filter(m => 
        m.toLowerCase().includes('submit') || 
        m.toLowerCase().includes('send')
      );
      providerInfo.evaluateMethods = allMethods.filter(m => 
        m.toLowerCase().includes('eval') || 
        m.toLowerCase().includes('execute')
      );
      providerInfo.historyMethods = allMethods.filter(m => 
        m.toLowerCase().includes('history') || 
        m.toLowerCase().includes('recent') ||
        m.toLowerCase().includes('get')
      );
    });
    
    console.log("\n=== Provider Methods ===");
    console.log(JSON.stringify(providerInfo, null, 2));
    
    expect(true).toBe(true);
  });

  test("test transaction ID extraction from Core.Transaction", async () => {
    console.log("\n=== Core.Transaction Exploration ===");
    
    // Test TransactionId directly (need exactly 64 hex characters)
    const txId = Core.TransactionId("a".repeat(64));
    console.log("TransactionId type:", typeof txId);
    console.log("TransactionId value:", txId);
    console.log("TransactionId toString:", txId.toString());
    
    // Check if we can extract the hex directly
    if (txId && typeof txId === 'object') {
      console.log("TransactionId properties:", Object.keys(txId));
      console.log("TransactionId constructor:", txId.constructor?.name);
      
      // Try to get raw value
      const txIdAny = txId as any;
      if (txIdAny._value) console.log("_value:", txIdAny._value);
      if (txIdAny.value) console.log("value:", txIdAny.value);
      if (txIdAny.bytes) console.log("bytes:", txIdAny.bytes);
      if (txIdAny.hex) console.log("hex:", txIdAny.hex);
    }
    
    expect(true).toBe(true);
  });
});