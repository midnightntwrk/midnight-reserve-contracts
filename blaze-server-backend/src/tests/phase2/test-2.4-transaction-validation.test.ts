import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";

describe("Phase 2.4: Transaction ID Validation - Two Approaches (TECHNICAL DEBT - DISABLED)", () => {
  // Note: Using shared server and SessionManager from global test setup

  let compiledCode: string;


  test.skip("should return real transaction IDs for wallet transfers (TECHNICAL DEBT: Need to research how to get transaction hashes from Blaze emulator)", async () => {
    // Create a session
    const createSessionResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    const sessionData: any = await createSessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register two wallets
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "alice",
        initialBalance: "100000000"
      }),
    });

    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "bob",
        initialBalance: "50000000"
      }),
    });

    // Perform a transfer
    const transferResponse = await fetch("http://localhost:3001/api/wallet/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "alice",
        toWallet: "bob",
        amount: "10000000"
      }),
    });

    expect(transferResponse.status).toBe(200);
    const transferData: any = await transferResponse.json();
    
    // Validate transaction ID format and uniqueness
    const txId = transferData.transactionId;
    expect(txId).toBeDefined();
    expect(typeof txId).toBe("string");
    expect(txId.length).toBeGreaterThan(0);
    
    // Check that it's not just a timestamp-based ID
    expect(txId).not.toMatch(/^tx-\d+$/);
    expect(txId).not.toMatch(/^lock-tx-\d+$/);
    expect(txId).not.toMatch(/^invoke-tx-\d+$/);
    
    // Check that it looks like a real transaction hash (64 hex characters)
    expect(txId).toMatch(/^[a-fA-F0-9]{64}$/);
  });

  test.skip("should return real transaction IDs for contract operations (TECHNICAL DEBT: Need to research how to get transaction hashes from Blaze emulator)", async () => {
    // Create a session
    const createSessionResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    const sessionData: any = await createSessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register wallets
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "deployer",
        initialBalance: "1000000000"
      }),
    });

    // Deploy contract
    const deployResponse = await fetch("http://localhost:3001/api/contract/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        deployerWallet: "deployer",
        compiledCode: compiledCode,
        datumSchema: { thing: "BigInt" },
        redeemerSchema: "BigInt"
      }),
    });

    expect(deployResponse.status).toBe(200);
    const deployData: any = await deployResponse.json();
    const contractAddress = deployData.contractAddress;

    // Lock funds to contract
    const lockResponse = await fetch("http://localhost:3001/api/contract/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "deployer",
        contractAddress: contractAddress,
        amount: "10000000",
        datum: "42"
      }),
    });

    expect(lockResponse.status).toBe(200);
    const lockData: any = await lockResponse.json();
    
    // Validate lock transaction ID
    const lockTxId = lockData.transactionId;
    expect(lockTxId).toBeDefined();
    expect(typeof lockTxId).toBe("string");
    expect(lockTxId).toMatch(/^[a-fA-F0-9]{64}$/);
    expect(lockTxId).not.toMatch(/^lock-tx-\d+$/);

    // Invoke contract
    const invokeResponse = await fetch("http://localhost:3001/api/contract/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "deployer",
        contractAddress: contractAddress,
        redeemer: "42"
      }),
    });

    expect(invokeResponse.status).toBe(200);
    const invokeData: any = await invokeResponse.json();
    
    // Validate invoke transaction ID
    const invokeTxId = invokeData.transactionId;
    expect(invokeTxId).toBeDefined();
    expect(typeof invokeTxId).toBe("string");
    expect(invokeTxId).toMatch(/^[a-fA-F0-9]{64}$/);
    expect(invokeTxId).not.toMatch(/^invoke-tx-\d+$/);
    
    // Ensure different operations have different transaction IDs
    expect(lockTxId).not.toBe(invokeTxId);
  });

  test.skip("should return unique transaction IDs for multiple operations (TECHNICAL DEBT: Need to research how to get transaction hashes from Blaze emulator)", async () => {
    // Create a session
    const createSessionResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    const sessionData: any = await createSessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register wallets
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "alice",
        initialBalance: "1000000000"
      }),
    });

    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "bob",
        initialBalance: "1000000000"
      }),
    });

    // Perform multiple transfers
    const transfer1Response = await fetch("http://localhost:3001/api/wallet/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "alice",
        toWallet: "bob",
        amount: "10000000"
      }),
    });

    const transfer2Response = await fetch("http://localhost:3001/api/wallet/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "bob",
        toWallet: "alice",
        amount: "5000000"
      }),
    });

    expect(transfer1Response.status).toBe(200);
    expect(transfer2Response.status).toBe(200);

    const transfer1Data: any = await transfer1Response.json();
    const transfer2Data: any = await transfer2Response.json();

    // Ensure transaction IDs are unique
    expect(transfer1Data.transactionId).not.toBe(transfer2Data.transactionId);
    
    // Ensure both are valid transaction hashes
    expect(transfer1Data.transactionId).toMatch(/^[a-fA-F0-9]{64}$/);
    expect(transfer2Data.transactionId).toMatch(/^[a-fA-F0-9]{64}$/);
  });
});
