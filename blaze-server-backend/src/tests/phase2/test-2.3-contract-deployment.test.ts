import { describe, test, expect, beforeAll } from "bun:test";
import fs from "fs";
import path from "path";

describe("Phase 2.3: Dynamic Contract Deployment", () => {
  // Note: Using shared server and SessionManager from global test setup

  let compiledCode: string;

  beforeAll(() => {
    // Load compiled contract code from plutus.json
    const plutusJsonPath = path.join(process.cwd(), "plutus.json");
    const plutusJson = JSON.parse(fs.readFileSync(plutusJsonPath, "utf8"));
    
    // Find the spend validator for hello_world
    const spendValidator = plutusJson.validators.find(
      (v: any) => v.title === "hello_world.hello_world.spend"
    );
    
    if (!spendValidator) {
      throw new Error("Could not find hello_world.spend validator in plutus.json");
    }
    
    compiledCode = spendValidator.compiledCode;
  });


  test("should deploy hello_world contract via HTTP endpoint", async () => {
    // First create a session
    const createSessionResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    const sessionData: any = await createSessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register Abel with funds for deployment
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "abel",
        initialBalance: "1000000000"
      }),
    });

    // Deploy hello_world contract using its bytecode
    const deployResponse = await fetch("http://localhost:3001/api/contract/deploy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        deployerWallet: "abel",
        compiledCode: compiledCode,
        datumSchema: { thing: "BigInt" },
        redeemerSchema: "BigInt"
      }),
    });

    expect(deployResponse.status).toBe(200);
    const deployData: any = await deployResponse.json();
    expect(deployData.success).toBe(true);
    expect(deployData.contractId).toBe("5b7e059453488d25906a7920dfe4b750ff4bd8c0afb6fecf8721b050");
    expect(deployData.contractAddress).toMatch(/^addr_test1/);
    expect(deployData.deployedAt).toBeDefined();
  });

  test("should allow Betty to invoke deployed contract", async () => {
    // First create a session
    const createSessionResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    const sessionData: any = await createSessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register Abel with funds for deployment
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "abel",
        initialBalance: "1000000000"
      }),
    });

    // Register Betty with funds for invocation
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "betty",
        initialBalance: "500000000"
      }),
    });

    // Deploy hello_world contract using its bytecode
    const deployResponse = await fetch("http://localhost:3001/api/contract/deploy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        deployerWallet: "abel",
        compiledCode: compiledCode,
        datumSchema: { thing: "BigInt" },
        redeemerSchema: "BigInt"
      }),
    });

    const deployData: any = await deployResponse.json();
    const contractAddress = deployData.contractAddress;

    // Abel locks funds to the contract first
    const lockResponse = await fetch("http://localhost:3001/api/contract/lock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "abel",
        contractAddress: contractAddress,
        amount: "10000000",
        datum: "42"
      }),
    });

    expect(lockResponse.status).toBe(200);

    // Betty invokes the contract with a redeemer
    const invokeResponse = await fetch("http://localhost:3001/api/contract/invoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "betty",
        contractAddress: contractAddress,
        redeemer: "42"
      }),
    });

    expect(invokeResponse.status).toBe(200);
    const invokeData: any = await invokeResponse.json();
    expect(invokeData.success).toBe(true);
    expect(invokeData.transactionId).toBeDefined();
    expect(invokeData.fromWallet).toBe("betty");
    expect(invokeData.contractAddress).toBe(contractAddress);
  });

  test("should allow Betty to consume specific UTXO with unpredictable values", async () => {
    // Generate fresh random redeemers each test run
    const randomRedeemer1 = Math.floor(Math.random() * 1000000000).toString();
    const randomRedeemer2 = Math.floor(Math.random() * 1000000000).toString();
    
    // First create a session
    const createSessionResponse = await fetch("http://localhost:3001/api/session/new", {
      method: "POST",
    });
    const sessionData: any = await createSessionResponse.json();
    const sessionId = sessionData.sessionId;

    // Register Abel with funds for deployment and locking
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "abel",
        initialBalance: "1000000000"
      }),
    });

    // Register Betty with funds for invocation
    await fetch("http://localhost:3001/api/wallet/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        name: "betty",
        initialBalance: "500000000"
      }),
    });

    // Deploy hello_world contract
    const deployResponse = await fetch("http://localhost:3001/api/contract/deploy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        deployerWallet: "abel",
        compiledCode: compiledCode,
        datumSchema: { thing: "BigInt" },
        redeemerSchema: "BigInt"
      }),
    });

    const deployData: any = await deployResponse.json();
    const contractAddress = deployData.contractAddress;

    // Abel locks funds to contract twice with different datum values (creates UTXOs)
    const lockResponse1 = await fetch("http://localhost:3001/api/contract/lock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "abel",
        contractAddress: contractAddress,
        amount: "10000000",
        datum: randomRedeemer1
      }),
    });

    const lockResponse2 = await fetch("http://localhost:3001/api/contract/lock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "abel",
        contractAddress: contractAddress,
        amount: "20000000",
        datum: randomRedeemer2
      }),
    });

    expect(lockResponse1.status).toBe(200);
    expect(lockResponse2.status).toBe(200);

    // Abel tells Betty: contract address + redeemer for first UTXO
    const targetRedeemer = randomRedeemer1;

    // Betty invokes with the specific redeemer (should consume first UTXO)
    const bettyInvokeResponse = await fetch("http://localhost:3001/api/contract/invoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "betty",
        contractAddress: contractAddress,
        redeemer: targetRedeemer
      }),
    });

    expect(bettyInvokeResponse.status).toBe(200);

    // Abel tries to invoke with the same redeemer again (should FAIL - UTXO consumed)
    const abelInvokeResponse = await fetch("http://localhost:3001/api/contract/invoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId: sessionId,
        fromWallet: "abel",
        contractAddress: contractAddress,
        redeemer: targetRedeemer
      }),
    });

    expect(abelInvokeResponse.status).toBe(400); // Should fail - UTXO already consumed!
  });
});
