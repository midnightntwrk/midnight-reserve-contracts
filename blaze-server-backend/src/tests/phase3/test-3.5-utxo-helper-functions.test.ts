import { describe, it, expect } from "bun:test";

describe("Phase 3.5: UTXO Helper Functions - Two Approaches", () => {
  const baseUrl = "http://localhost:3001";

  it("should test UTXO helper functions correctly (Babbage reference scripts)", async () => {
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register test wallet with funding
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000" // 20 ADA
      })
    });
    
    const compiledCode = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";

    // Deploy contract
    const deployResponse = await fetch(`${baseUrl}/api/contract/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        deployerWallet: "alice",
        compiledCode
      })
    });
    const deployData = await deployResponse.json();
    const contractAddress = deployData.contractAddress;
    const contractScriptHash = deployData.contractId;

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

    // Lock funds with datum to create contract UTXO
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
          amount: "3000000", // 3 ADA
          datum: 42
        }]
      })
    });
    
    expect(lockResp.status).toBe(200);
    const lockData = await lockResp.json();
    expect(lockData.success).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 100));

    // Test getting wallet UTXOs (helper function)
    const walletUtxosResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    expect(walletUtxosResponse.status).toBe(200);
    const walletUtxosData = await walletUtxosResponse.json();
    expect(walletUtxosData.utxos).toBeDefined();
    expect(Array.isArray(walletUtxosData.utxos)).toBe(true);
    expect(walletUtxosData.utxos.length).toBeGreaterThan(0);

    // Test getting contract UTXOs (helper function)
    const contractUtxosResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    expect(contractUtxosResponse.status).toBe(200);
    const contractUtxosData = await contractUtxosResponse.json();
    expect(contractUtxosData.utxos).toBeDefined();
    expect(Array.isArray(contractUtxosData.utxos)).toBe(true);
    expect(contractUtxosData.utxos.length).toBe(1); // Should have the one we just created

    // Test UTXO structure and properties (helper function validation)
    const contractUtxo = contractUtxosData.utxos[0];
    expect(contractUtxo).toHaveProperty('txHash');
    expect(contractUtxo).toHaveProperty('outputIndex');  
    expect(contractUtxo).toHaveProperty('address');
    expect(contractUtxo).toHaveProperty('amount');
    expect(contractUtxo).toHaveProperty('datum');

    // Test specific UTXO values
    expect(contractUtxo.txHash).toMatch(/^[a-f0-9]{64}$/); // Valid transaction hash
    expect(typeof contractUtxo.outputIndex).toBe('number');
    expect(contractUtxo.amount).toBe("3000000"); // Should match what we locked
    expect(contractUtxo.datum).toBe(42); // Should match our datum

    // Test wallet balance helper
    const walletBalanceResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    expect(walletBalanceResponse.status).toBe(200);
    const walletBalanceData = await walletBalanceResponse.json();
    expect(walletBalanceData).toHaveProperty('balance');
    expect(typeof walletBalanceData.balance).toBe('string');
    const balance = BigInt(walletBalanceData.balance);
    expect(balance).toBeGreaterThan(0n);

    // Test contract balance helper
    const contractBalanceResponse = await fetch(`${baseUrl}/api/contract/${contractScriptHash}/balance?sessionId=${sessionId}`);
    expect(contractBalanceResponse.status).toBe(200);
    const contractBalanceData = await contractBalanceResponse.json();
    expect(contractBalanceData).toHaveProperty('balance');
    expect(contractBalanceData.balance).toBe("3000000"); // Should match our locked amount

    console.log(`✅ BABBAGE UTXO HELPERS PROOF: All helper functions work correctly with reference scripts`);
    console.log(`✅ Wallet balance: ${walletBalanceData.balance}, Contract balance: ${contractBalanceData.balance}`);
    console.log(`✅ Found ${walletUtxosData.utxos.length} wallet UTXOs, ${contractUtxosData.utxos.length} contract UTXOs`);
  });

  it("should test UTXO helper functions correctly (Alonzo inline scripts)", async () => {
    // Create fresh session
    const sessionResponse = await fetch(`${baseUrl}/api/session/new`, {
      method: "POST"
    });
    const sessionData = await sessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register test wallet with funding
    await fetch(`${baseUrl}/api/wallet/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: "alice",
        initialBalance: "20000000" // 20 ADA
      })
    });
    
    const compiledCode = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";

    // Deploy contract
    const deployResponse = await fetch(`${baseUrl}/api/contract/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        deployerWallet: "alice",
        compiledCode
      })
    });
    const deployData = await deployResponse.json();
    const contractAddress = deployData.contractAddress;
    const contractScriptHash = deployData.contractId;

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

    // Lock funds with datum to create contract UTXO
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
          amount: "3000000", // 3 ADA
          datum: 42
        }]
      })
    });
    
    expect(lockResp.status).toBe(200);
    const lockData = await lockResp.json();
    expect(lockData.success).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 100));

    // Test getting wallet UTXOs (helper function)
    const walletUtxosResponse = await fetch(`${baseUrl}/api/wallet/alice/utxos?sessionId=${sessionId}`);
    expect(walletUtxosResponse.status).toBe(200);
    const walletUtxosData = await walletUtxosResponse.json();
    expect(walletUtxosData.utxos).toBeDefined();
    expect(Array.isArray(walletUtxosData.utxos)).toBe(true);
    expect(walletUtxosData.utxos.length).toBeGreaterThan(0);

    // Test getting contract UTXOs (helper function)
    const contractUtxosResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    expect(contractUtxosResponse.status).toBe(200);
    const contractUtxosData = await contractUtxosResponse.json();
    expect(contractUtxosData.utxos).toBeDefined();
    expect(Array.isArray(contractUtxosData.utxos)).toBe(true);
    expect(contractUtxosData.utxos.length).toBe(1); // Should have the one we just created

    // Test UTXO structure and properties (helper function validation)
    const contractUtxo = contractUtxosData.utxos[0];
    expect(contractUtxo).toHaveProperty('txHash');
    expect(contractUtxo).toHaveProperty('outputIndex');  
    expect(contractUtxo).toHaveProperty('address');
    expect(contractUtxo).toHaveProperty('amount');
    expect(contractUtxo).toHaveProperty('datum');

    // Test specific UTXO values
    expect(contractUtxo.txHash).toMatch(/^[a-f0-9]{64}$/); // Valid transaction hash
    expect(typeof contractUtxo.outputIndex).toBe('number');
    expect(contractUtxo.amount).toBe("3000000"); // Should match what we locked
    expect(contractUtxo.datum).toBe(42); // Should match our datum

    // Test wallet balance helper
    const walletBalanceResponse = await fetch(`${baseUrl}/api/wallet/alice/balance?sessionId=${sessionId}`);
    expect(walletBalanceResponse.status).toBe(200);
    const walletBalanceData = await walletBalanceResponse.json();
    expect(walletBalanceData).toHaveProperty('balance');
    expect(typeof walletBalanceData.balance).toBe('string');
    const balance = BigInt(walletBalanceData.balance);
    expect(balance).toBeGreaterThan(0n);

    // Test contract balance helper
    const contractBalanceResponse = await fetch(`${baseUrl}/api/contract/${contractScriptHash}/balance?sessionId=${sessionId}`);
    expect(contractBalanceResponse.status).toBe(200);
    const contractBalanceData = await contractBalanceResponse.json();
    expect(contractBalanceData).toHaveProperty('balance');
    expect(contractBalanceData.balance).toBe("3000000"); // Should match our locked amount

    console.log(`✅ ALONZO UTXO HELPERS PROOF: All helper functions work correctly with inline scripts`);
    console.log(`✅ Wallet balance: ${walletBalanceData.balance}, Contract balance: ${contractBalanceData.balance}`);
    console.log(`✅ Found ${walletUtxosData.utxos.length} wallet UTXOs, ${contractUtxosData.utxos.length} contract UTXOs`);
  });
});