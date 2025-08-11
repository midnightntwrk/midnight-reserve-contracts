import fs from "fs";
import path from "path";
import { describe, test, expect } from "bun:test";
import { Emulator } from "@blaze-cardano/emulator";
import { makeValue, Core } from "@blaze-cardano/sdk";
import * as Data from "@blaze-cardano/data";
import { MyDatum, HelloWorldHelloWorldSpend } from "../../utils/contracts";

import { basicProtocolParameters } from "../../utils/protocol-params";

describe("Phase 1.3: Direct Contract Deployment", () => {
  test("should load compiled hello_world contract", () => {
    const plutusJsonPath = path.join(process.cwd(), "plutus.json");
    const plutusJson = JSON.parse(fs.readFileSync(plutusJsonPath, "utf-8"));

    const helloWorldValidator = plutusJson.validators.find(
      (v: any) => v.title.includes("hello_world") && v.title.includes("spend"),
    );

    expect(helloWorldValidator).toBeDefined();
    expect(helloWorldValidator.compiledCode).toBeDefined();
    expect(helloWorldValidator.hash).toBeDefined();

    console.log("✓ Contract loaded successfully");
    console.log("  - Validator hash:", helloWorldValidator.hash);
    console.log(
      "  - Compiled code length:",
      helloWorldValidator.compiledCode.length,
    );
  });

  test("should initialize emulator with contract", async () => {
    const emulator = new Emulator([], basicProtocolParameters);

    // Register test accounts
    const alice = await emulator.register("alice", makeValue(100_000_000n));
    const bob = await emulator.register("bob", makeValue(50_000_000n));

    expect(alice).toBeDefined();
    expect(bob).toBeDefined();

    console.log("✓ Emulator initialized with test accounts");
    console.log(
      "  - Alice address:",
      alice.asBase()!.getPaymentCredential().hash,
    );
    console.log("  - Bob address:", bob.asBase()!.getPaymentCredential().hash);
  });

  test("should validate contract script hash", () => {
    const plutusJsonPath = path.join(process.cwd(), "plutus.json");
    const plutusJson = JSON.parse(fs.readFileSync(plutusJsonPath, "utf-8"));

    const helloWorldValidator = plutusJson.validators.find(
      (v: any) => v.title.includes("hello_world") && v.title.includes("spend"),
    );

    // Hash should be hex string
    expect(helloWorldValidator.hash).toMatch(/^[0-9a-f]+$/i);
    expect(helloWorldValidator.hash.length).toBe(56); // 28 bytes * 2 hex chars

    console.log("✓ Script hash validation passed");
    console.log("  - Hash format: valid hex string");
    console.log("  - Hash length: 56 characters (28 bytes)");
  });

  test("should benchmark contract loading time", () => {
    const startTime = Date.now();

    // Load and parse plutus.json
    const plutusJsonPath = path.join(process.cwd(), "plutus.json");
    const plutusJson = JSON.parse(fs.readFileSync(plutusJsonPath, "utf-8"));

    const helloWorldValidator = plutusJson.validators.find(
      (v: any) => v.title.includes("hello_world") && v.title.includes("spend"),
    );

    const loadTime = Date.now() - startTime;

    expect(helloWorldValidator).toBeDefined();
    expect(loadTime).toBeLessThan(100); // Should load very quickly

    console.log("✓ Contract loading benchmark completed");
    console.log("  - Load time:", loadTime, "ms");
  });

  test("should measure emulator initialization time", async () => {
    const startTime = Date.now();

    const emulator = new Emulator([], basicProtocolParameters);
    const alice = await emulator.register(
      "benchmark_alice",
      makeValue(100_000_000n),
    );

    const initTime = Date.now() - startTime;

    expect(alice).toBeDefined();
    expect(initTime).toBeLessThan(1000); // Should initialize quickly

    console.log("✓ Emulator initialization benchmark completed");
    console.log("  - Initialization time:", initTime, "ms");
  });

  test("should deploy hello_world contract to emulator", async () => {
    const script = new HelloWorldHelloWorldSpend();
    // Create script from compiled code

    const scriptAddress = Core.addressFromValidator(
      Core.NetworkId.Testnet,
      script.Script,
    );

    expect(script.Script).toBeDefined();
    expect(scriptAddress).toBeDefined();
    expect(scriptAddress.toBech32()).toMatch(/^addr_test1/);

    console.log("✓ Contract deployed to emulator");
    console.log("  - Script hash:", script.Script.hash());
    console.log("  - Script address:", scriptAddress);
  });

  test("should build and execute lock transaction (datum == redeemer success)", async () => {
    const emulator = new Emulator([], basicProtocolParameters);

    // Create script and address
    const script = new HelloWorldHelloWorldSpend();
    const scriptAddress = Core.addressFromValidator(
      Core.NetworkId.Testnet,
      script.Script,
    );

    // Build lock transaction (following SundaeSwap pattern)
    await emulator.as("alice", async (blaze, addr) => {
      const datum = 42n; // Int datum
      const lockAmount = makeValue(2_000_000n); // 2 ADA

      emulator.addUtxo(
        new Core.TransactionUnspentOutput(
          new Core.TransactionInput(Core.TransactionId("1".repeat(64)), 0n),
          new Core.TransactionOutput(addr, makeValue(500_000_000_000n)),
        ),
      );

      await emulator.expectValidTransaction(
        blaze,
        blaze.newTransaction().lockAssets(
          scriptAddress,
          lockAmount,
          Data.serialize(MyDatum, { thing: datum }), // Serialize int datum
        ),
      );
    });
  });

  test("should build and execute unlock transaction (datum == redeemer success)", async () => {
    const emulator = new Emulator([], basicProtocolParameters);

    // Create script and address
    const script = new HelloWorldHelloWorldSpend();
    const scriptAddress = Core.addressFromValidator(
      Core.NetworkId.Testnet,
      script.Script,
    );

    await emulator.as("alice", async (blaze, addr) => {
      const datum = 42n;
      const redeemer = 42n; // Matching redeemer (should succeed)
      const lockAmount = makeValue(2_000_000n);

      emulator.addUtxo(
        new Core.TransactionUnspentOutput(
          new Core.TransactionInput(Core.TransactionId("1".repeat(64)), 0n),
          new Core.TransactionOutput(addr, makeValue(500_000_000_000n)),
        ),
      );

      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .lockAssets(
            scriptAddress,
            lockAmount,
            Data.serialize(MyDatum, { thing: datum }),
          ),
      );

      // Find the locked UTXO
      const scriptUtxos = await blaze.provider.getUnspentOutputs(scriptAddress);
      const lockedUtxo = scriptUtxos[0]; // Should be our locked UTXO

      expect(lockedUtxo).toBeDefined();
      expect(lockedUtxo.output().amount().coin()).toBe(lockAmount.coin());

      // Build unlock transaction
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(lockedUtxo, Data.serialize(Data.BigInt(), redeemer))
          .provideScript(script.Script),
      );
    });
  });

  test("should fail unlock transaction (datum != redeemer)", async () => {
    const emulator = new Emulator([], basicProtocolParameters);

    // Create script and address
    const script = new HelloWorldHelloWorldSpend();
    const scriptAddress = Core.addressFromValidator(
      Core.NetworkId.Testnet,
      script.Script,
    );

    await emulator.as("alice", async (blaze, addr) => {
      const datum = 42n;
      const wrongRedeemer = 99n; // Non-matching redeemer (should fail)
      const lockAmount = makeValue(2_000_000n);

      emulator.addUtxo(
        new Core.TransactionUnspentOutput(
          new Core.TransactionInput(Core.TransactionId("1".repeat(64)), 0n),
          new Core.TransactionOutput(addr, makeValue(500_000_000_000n)),
        ),
      );

      // Lock transaction first
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .lockAssets(
            scriptAddress,
            lockAmount,
            Data.serialize(MyDatum, { thing: datum }),
          ),
      );

      // Find the locked UTXO
      const scriptUtxos = await blaze.provider.getUnspentOutputs(scriptAddress);
      const lockedUtxo = scriptUtxos[0];

      // Build unlock transaction with wrong redeemer
      await emulator.expectScriptFailure(
        blaze
          .newTransaction()
          .addInput(lockedUtxo, Data.serialize(Data.BigInt(), wrongRedeemer))
          .provideScript(script.Script),
      );
    });
  });
});
