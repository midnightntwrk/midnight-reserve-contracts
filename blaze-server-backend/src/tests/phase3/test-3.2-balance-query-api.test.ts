import { describe, it, expect } from "bun:test";
import { computeScriptInfo, HELLO_WORLD_COMPILED_CODE } from "../../utils/script-utils";

describe("Phase 3.2: Balance Query API - Two Approaches", () => {
  const baseUrl = "http://localhost:3031";

  it("should query wallet and contract balances correctly (Babbage reference scripts)", async () => {
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register test wallet
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000" // 20 ADA
      })
    });
    
    const compiledCode = HELLO_WORLD_COMPILED_CODE;

    // Compute contract info directly (no deployment needed)
    const { scriptHash: contractScriptHash, contractAddress } = computeScriptInfo(compiledCode);

    // Test initial wallet balance
    const initialBalanceResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    expect(initialBalanceResponse.status).toBe(200);
    const initialBalanceData = await initialBalanceResponse.json();
    expect(initialBalanceData.balance).toBe("20000000");

    // Setup reference scripts and UTXOs
    const aliceUtxosResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosData = await aliceUtxosResp.json();
    const aliceAddress = aliceUtxosData.utxos[0].address;
    
    const setupResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "pay-to-address",
          address: aliceAddress,
          amount: "2000000", // 2 ADA for reference script
          referenceScript: compiledCode
        }, {
          type: "pay-to-address", 
          address: aliceAddress,
          amount: "8000000" // 8 ADA for spending
        }]
      })
    });
    
    const setupTx = await setupResp.json();
    const refScriptUtxo = setupTx.createdUtxos.find((utxo: any) => utxo.amount === "2000000");
    const spendingUtxo = setupTx.createdUtxos.find((utxo: any) => utxo.amount === "8000000");

    // Lock some funds to contract
    const lockResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "spend-specific-utxos",
          utxos: [{ txHash: spendingUtxo.txHash, outputIndex: spendingUtxo.outputIndex }]
        }, {
          type: "pay-to-contract",
          contractAddress: contractScriptHash,
          compiledCode: compiledCode, // Include script bytes for address computation
          amount: "3000000", // 3 ADA
          datum: 123
        }]
      })
    });
    
    expect(lockResp.status).toBe(200);
    const lockData = await lockResp.json();
    expect(lockData.success).toBe(true);


    // Test contract balance after locking funds (using UTXOs endpoint to calculate balance)
    const contractUtxosResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    expect(contractUtxosResponse.status).toBe(200);
    const contractUtxosData = await contractUtxosResponse.json();
    
    // Calculate total balance from UTXOs
    const totalBalance = contractUtxosData.utxos.reduce((sum: number, utxo: any) => sum + parseInt(utxo.amount), 0);
    expect(totalBalance).toBe(3000000); // Should have the 3 ADA we locked

    // Test wallet balance decreased
    const updatedBalanceResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    expect(updatedBalanceResponse.status).toBe(200);
    const updatedBalanceData = await updatedBalanceResponse.json();
    const updatedBalance = BigInt(updatedBalanceData.balance);
    expect(updatedBalance).toBeLessThan(20000000n); // Should be less than initial balance

    console.log(`✅ BABBAGE BALANCE QUERY PROOF: Balance queries work correctly with reference scripts`);
    console.log(`✅ Contract balance: ${totalBalance} lovelace`);
    console.log(`✅ Alice balance: ${updatedBalanceData.balance} lovelace`);
  });

  it("should query wallet and contract balances correctly (Alonzo inline scripts)", async () => {
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register test wallet
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000" // 20 ADA
      })
    });
    
    const compiledCode = HELLO_WORLD_COMPILED_CODE;

    // Compute contract info directly (no deployment needed)
    const { scriptHash: contractScriptHash, contractAddress } = computeScriptInfo(compiledCode);

    // Test initial wallet balance
    const initialBalanceResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    expect(initialBalanceResponse.status).toBe(200);
    const initialBalanceData = await initialBalanceResponse.json();
    expect(initialBalanceData.balance).toBe("20000000");

    // Setup spending UTXO (no reference scripts)
    const aliceUtxosResp = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    const aliceUtxosData = await aliceUtxosResp.json();
    const aliceAddress = aliceUtxosData.utxos[0].address;
    
    const setupResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "pay-to-address", 
          address: aliceAddress,
          amount: "10000000" // 10 ADA for spending
        }]
      })
    });
    
    const setupTx = await setupResp.json();
    const spendingUtxo = setupTx.createdUtxos.find((utxo: any) => utxo.amount === "10000000");

    // Lock some funds to contract
    const lockResp = await fetch(`${baseUrl}/api/transaction/build-and-submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        signerWallet: "alice",
        operations: [{
          type: "spend-specific-utxos",
          utxos: [{ txHash: spendingUtxo.txHash, outputIndex: spendingUtxo.outputIndex }]
        }, {
          type: "pay-to-contract",
          contractAddress: contractScriptHash,
          compiledCode: compiledCode, // Include script bytes for address computation
          amount: "3000000", // 3 ADA
          datum: 123
        }]
      })
    });
    
    expect(lockResp.status).toBe(200);
    const lockData = await lockResp.json();
    expect(lockData.success).toBe(true);


    // Test contract balance after locking funds (using UTXOs endpoint to calculate balance)
    const contractUtxosResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    expect(contractUtxosResponse.status).toBe(200);
    const contractUtxosData = await contractUtxosResponse.json();
    
    // Calculate total balance from UTXOs
    const totalBalance = contractUtxosData.utxos.reduce((sum: number, utxo: any) => sum + parseInt(utxo.amount), 0);
    expect(totalBalance).toBe(3000000); // Should have the 3 ADA we locked

    // Test wallet balance decreased
    const updatedBalanceResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    expect(updatedBalanceResponse.status).toBe(200);
    const updatedBalanceData = await updatedBalanceResponse.json();
    const updatedBalance = BigInt(updatedBalanceData.balance);
    expect(updatedBalance).toBeLessThan(20000000n); // Should be less than initial balance

    console.log(`✅ ALONZO BALANCE QUERY PROOF: Balance queries work correctly with inline scripts`);
    console.log(`✅ Contract balance: ${totalBalance} lovelace`);
    console.log(`✅ Alice balance: ${updatedBalanceData.balance} lovelace`);
  });
});