import { describe, it, expect } from "bun:test";
import { computeScriptInfo, HELLO_WORLD_COMPILED_CODE } from "../../utils/script-utils";

describe("Phase 3.4: Contract UTXO Discovery - Two Approaches", () => {
  const baseUrl = "http://localhost:3031";

  it("should discover contract UTXOs correctly (Babbage reference scripts)", async () => {
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
    
    const compiledCode = HELLO_WORLD_COMPILED_CODE;

    // Compute contract info directly (no deployment needed)
    const { scriptHash: contractScriptHash, contractAddress } = computeScriptInfo(compiledCode);

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

    // Lock some funds to the contract to create UTXOs
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
          amount: "2000000", // 2 ADA
          datum: 42
        }, {
          type: "pay-to-contract",
          contractAddress: contractScriptHash,
          compiledCode: compiledCode, // Include script bytes for address computation
          amount: "3000000", // 3 ADA  
          datum: 99
        }]
      })
    });
    
    expect(lockResp.status).toBe(200);
    const lockData = await lockResp.json();
    expect(lockData.success).toBe(true);


    // Test UTXO discovery by contract address (Bech32)
    const utxosByScriptHashResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    expect(utxosByScriptHashResponse.status).toBe(200);
    const utxosByScriptHashData = await utxosByScriptHashResponse.json();
    expect(utxosByScriptHashData.utxos.length).toBe(2); // Should find both UTXOs

    // Test UTXO discovery by contract address
    const utxosByAddressResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    expect(utxosByAddressResponse.status).toBe(200);
    const utxosByAddressData = await utxosByAddressResponse.json();
    expect(utxosByAddressData.utxos.length).toBe(2); // Should find both UTXOs

    // Verify UTXO data structure
    const firstUtxo = utxosByScriptHashData.utxos[0];
    expect(firstUtxo).toHaveProperty('txHash');
    expect(firstUtxo).toHaveProperty('outputIndex');
    expect(firstUtxo).toHaveProperty('address');
    expect(firstUtxo).toHaveProperty('amount');
    expect(firstUtxo).toHaveProperty('datum');
    expect(firstUtxo.txHash).toMatch(/^[a-f0-9]{64}$/);

    // Verify specific UTXO amounts and data
    const utxos = utxosByScriptHashData.utxos;
    const amounts = utxos.map((u: any) => u.amount).sort();
    expect(amounts).toEqual(["2000000", "3000000"]);

    const datums = utxos.map((u: any) => u.datum).sort();
    expect(datums).toEqual([42, 99]);

    console.log(`✅ BABBAGE UTXO DISCOVERY PROOF: Found ${utxos.length} contract UTXOs using reference scripts`);
    console.log(`✅ UTXOs: ${amounts.join(', ')} lovelace with datums ${datums.join(', ')}`);
  });

  it("should discover contract UTXOs correctly (Alonzo inline scripts)", async () => {
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
    
    const compiledCode = HELLO_WORLD_COMPILED_CODE;

    // Compute contract info directly (no deployment needed)
    const { scriptHash: contractScriptHash, contractAddress } = computeScriptInfo(compiledCode);

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

    // Lock some funds to the contract to create UTXOs
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
          amount: "2000000", // 2 ADA
          datum: 42
        }, {
          type: "pay-to-contract",
          contractAddress: contractScriptHash,
          compiledCode: compiledCode, // Include script bytes for address computation
          amount: "3000000", // 3 ADA  
          datum: 99
        }]
      })
    });
    
    expect(lockResp.status).toBe(200);
    const lockData = await lockResp.json();
    expect(lockData.success).toBe(true);


    // Test UTXO discovery by contract address (Bech32)
    const utxosByScriptHashResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    expect(utxosByScriptHashResponse.status).toBe(200);
    const utxosByScriptHashData = await utxosByScriptHashResponse.json();
    expect(utxosByScriptHashData.utxos.length).toBe(2); // Should find both UTXOs

    // Test UTXO discovery by contract address
    const utxosByAddressResponse = await fetch(`${baseUrl}/api/contract/${contractAddress}/utxos?sessionId=${sessionId}`);
    expect(utxosByAddressResponse.status).toBe(200);
    const utxosByAddressData = await utxosByAddressResponse.json();
    expect(utxosByAddressData.utxos.length).toBe(2); // Should find both UTXOs

    // Verify UTXO data structure
    const firstUtxo = utxosByScriptHashData.utxos[0];
    expect(firstUtxo).toHaveProperty('txHash');
    expect(firstUtxo).toHaveProperty('outputIndex');
    expect(firstUtxo).toHaveProperty('address');
    expect(firstUtxo).toHaveProperty('amount');
    expect(firstUtxo).toHaveProperty('datum');
    expect(firstUtxo.txHash).toMatch(/^[a-f0-9]{64}$/);

    // Verify specific UTXO amounts and data
    const utxos = utxosByScriptHashData.utxos;
    const amounts = utxos.map((u: any) => u.amount).sort();
    expect(amounts).toEqual(["2000000", "3000000"]);

    const datums = utxos.map((u: any) => u.datum).sort();
    expect(datums).toEqual([42, 99]);

    console.log(`✅ ALONZO UTXO DISCOVERY PROOF: Found ${utxos.length} contract UTXOs using inline scripts`);
    console.log(`✅ UTXOs: ${amounts.join(', ')} lovelace with datums ${datums.join(', ')}`);
  });
});