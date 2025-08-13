import express from "express";
import { SessionManager } from "./utils/session-manager";
import { makeValue } from "@blaze-cardano/sdk";
import * as Core from "@blaze-cardano/core";
import { cborToScript } from "@blaze-cardano/uplc";
import * as Data from "@blaze-cardano/data";
import { MyDatum } from "./utils/contracts";

export function createServer(sessionManager: SessionManager) {
  const app = express();
  app.use(express.json());

  app.post("/api/session/new", async (req, res) => {
    try {
      const session = await sessionManager.createSession();
      res.json({
        success: true,
        sessionId: session.id,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to create session"
      });
    }
  });

  app.post("/api/wallet/register", async (req, res) => {
    const { sessionId, name, initialBalance } = req.body;
    
    // Validate session ID
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }

    // Check if wallet already exists using emulator's built-in tracking
    if (currentSession.emulator.mockedWallets.has(name)) {
      return res.status(400).json({
        success: false,
        error: `Wallet '${name}' already exists`
      });
    }

    try {
      const wallet = await currentSession.emulator.register(name, makeValue(BigInt(initialBalance)));
      
      // Verify the actual balance by querying the emulator using the correct pattern
      let actualBalance = 0n;
      await currentSession.emulator.as(name, async (blaze, addr) => {
        const utxos = await blaze.provider.getUnspentOutputs(addr);
        actualBalance = utxos.reduce((total: bigint, utxo: any) => total + utxo.output().amount().coin(), 0n);
      });
      
      res.json({
        success: true,
        walletName: name,
        balance: actualBalance.toString()
      });
    } catch (error) {
      console.log("Wallet registration error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to register wallet"
      });
    }
  });

  app.post("/api/wallet/transfer", async (req, res) => {
    const { sessionId, fromWallet, toWallet, amount } = req.body;

    // Validate session ID
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }

    // Validate that both wallets exist
    if (!currentSession.emulator.mockedWallets.has(fromWallet)) {
      return res.status(400).json({
        success: false,
        error: `Source wallet '${fromWallet}' does not exist`
      });
    }

    if (!currentSession.emulator.mockedWallets.has(toWallet)) {
      return res.status(400).json({
        success: false,
        error: `Destination wallet '${toWallet}' does not exist`
      });
    }

    try {
      // Get the destination wallet's address
      let toAddress: any;
      await currentSession.emulator.as(toWallet, async (blaze: any, addr: any) => {
        toAddress = addr;
      });

              // Execute the transfer from source wallet
        await currentSession.emulator.as(fromWallet, async (blaze: any, addr: any) => {
          // Create a proper TransactionOutput object
          const output = new Core.TransactionOutput(toAddress, makeValue(BigInt(amount)));
          await currentSession.emulator.expectValidTransaction(
            blaze,
            blaze.newTransaction().addOutput(output)
          );
        });

      res.json({
        success: true,
        fromWallet,
        toWallet,
        amount,
        transactionId: "tx-" + Date.now()
      });
    } catch (error) {
      // Only log unexpected errors, not insufficient funds
      if (!(error instanceof Error && error.message.includes("UTxO Balance Insufficient"))) {
        console.log("Transfer error:", error);
      }
      
      // Check if this is an insufficient funds error from the emulator
      if (error instanceof Error && error.message.includes("UTxO Balance Insufficient")) {
        return res.status(400).json({
          success: false,
          error: "Insufficient funds for transfer"
        });
      }
      
      res.status(500).json({
        success: false,
        error: "Failed to transfer funds"
      });
    }
  });

  app.get("/api/network/tip", async (req, res) => {
    const { sessionId } = req.query;
    
    // Validate session ID
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }

    try {
      // Get real emulator state using the clock
      const emulator = currentSession.emulator;
      const currentSlot = emulator.clock.slot;
      
      res.json({
        success: true,
        slot: currentSlot,
        blockHeight: Math.floor(currentSlot / 20), // Rough conversion: 20 slots per block
        emulatorActive: true
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to get network tip"
      });
    }
  });

  app.post("/api/contract/deploy", async (req, res) => {
    const { sessionId, deployerWallet, compiledCode, datumSchema, redeemerSchema } = req.body;

    // Validate session ID
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }

    // Validate that deployer wallet exists
    if (!currentSession.emulator.mockedWallets.has(deployerWallet)) {
      return res.status(400).json({
        success: false,
        error: `Deployer wallet '${deployerWallet}' does not exist`
      });
    }

    try {
      // Create script from compiled code
      const script = cborToScript(compiledCode, "PlutusV3");
      const scriptAddress = Core.addressFromValidator(Core.NetworkId.Testnet, script);

      // Store the compiled code for later use
      currentSession.deployedContracts.set(scriptAddress.toBech32(), compiledCode);

      res.json({
        success: true,
        contractId: script.hash(),
        contractAddress: scriptAddress.toBech32(),
        deployedAt: new Date().toISOString()
      });
    } catch (error) {
      console.log("Contract deployment error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to deploy contract"
      });
    }
  });

  app.post("/api/contract/lock", async (req, res) => {
    const { sessionId, fromWallet, contractAddress, amount, datum } = req.body;

    // Validate session ID
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }

    // Validate that from wallet exists
    if (!currentSession.emulator.mockedWallets.has(fromWallet)) {
      return res.status(400).json({
        success: false,
        error: `Wallet '${fromWallet}' does not exist`
      });
    }

    try {
      // Get the script address from the contract address
      const scriptAddress = Core.addressFromBech32(contractAddress);
      
      // Execute the contract locking transaction
      await currentSession.emulator.as(fromWallet, async (blaze: any, addr: any) => {
        await currentSession.emulator.expectValidTransaction(
          blaze,
          blaze.newTransaction().lockAssets(
            scriptAddress,
            makeValue(BigInt(amount)),
            Data.serialize(MyDatum, { thing: BigInt(datum) })
          )
        );
      });

      res.json({
        success: true,
        fromWallet,
        contractAddress,
        amount,
        datum,
        transactionId: "lock-tx-" + Date.now()
      });
    } catch (error) {
      console.log("Contract lock error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to lock funds to contract"
      });
    }
  });

  app.post("/api/contract/invoke", async (req, res) => {
    const { sessionId, fromWallet, contractAddress, redeemer } = req.body;

    // Validate session ID
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }

    // Validate that from wallet exists
    if (!currentSession.emulator.mockedWallets.has(fromWallet)) {
      return res.status(400).json({
        success: false,
        error: `Wallet '${fromWallet}' does not exist`
      });
    }

    try {
      // Get the compiled code for this contract
      const compiledCode = currentSession.deployedContracts.get(contractAddress);
      if (!compiledCode) {
        return res.status(400).json({
          success: false,
          error: `Contract at address '${contractAddress}' not found`
        });
      }

      // Recreate the script from the compiled code
      const script = cborToScript(compiledCode, "PlutusV3");
      const scriptAddress = Core.addressFromBech32(contractAddress);
      
      // Find UTXOs at the contract address
      let scriptUtxos: any[] = [];
      await currentSession.emulator.as(fromWallet, async (blaze: any, addr: any) => {
        scriptUtxos = await blaze.provider.getUnspentOutputs(scriptAddress);
      });

      // Debug log the UTXOs to see their structure
      console.log("=== UTXO DEBUG INFO ===");
      console.log("Contract address:", contractAddress);
      console.log("Number of UTXOs found:", scriptUtxos.length);
      scriptUtxos.forEach((utxo: any, index: number) => {
        console.log(`UTXO ${index}:`, {
          input: utxo.input(),
          output: {
            address: utxo.output().address(),
            amount: utxo.output().amount(),
            datum: utxo.output().datum()
          }
        });
      });
      console.log("=== END UTXO DEBUG ===");

      // Check if there are UTXOs to spend
      if (scriptUtxos.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No UTXOs found at contract address"
        });
      }

      // Try each UTXO until one works with the redeemer
      let success = false;
      let lastError = null;

      for (const utxo of scriptUtxos) {
        try {
          await currentSession.emulator.as(fromWallet, async (blaze: any, addr: any) => {
            await currentSession.emulator.expectValidTransaction(
              blaze,
              blaze.newTransaction()
                .addInput(utxo, Data.serialize(Data.BigInt(), BigInt(redeemer)))
                .provideScript(script)
            );
          });
          success = true;
          break;
        } catch (error) {
          lastError = error;
          // Continue to next UTXO
        }
      }

      if (!success) {
        return res.status(400).json({
          success: false,
          error: `No UTXO found that accepts redeemer '${redeemer}'`
        });
      }

      res.json({
        success: true,
        fromWallet,
        contractAddress,
        redeemer,
        utxoConsumed: true,
        transactionId: "invoke-tx-" + Date.now()
      });
    } catch (error) {
      console.log("Contract call error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to call contract"
      });
    }
  });

  return new Promise((resolve) => {
    const server = app.listen(3001, () => {
      resolve(server);
    });
  });
}
