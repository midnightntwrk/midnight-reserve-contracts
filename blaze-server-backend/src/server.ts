import express from "express";
import { SessionManager } from "./utils/session-manager";
import { makeValue } from "@blaze-cardano/sdk";
import * as Core from "@blaze-cardano/core";
import { cborToScript } from "@blaze-cardano/uplc";
import * as Data from "@blaze-cardano/data";
import { MyDatum } from "./utils/contracts";
import { computeScriptInfo } from "./utils/script-utils";

export function createServer(sessionManager: SessionManager) {
  const app = express();
  
  app.use(express.json());

  // Logging state management
  let loggingEnabled = false;

  // Logging middleware for all HTTP requests/responses
  app.use((req, res, next) => {
    if (!loggingEnabled) {
      return next();
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [BlazeBackend] ${req.method} ${req.path}`, {
      query: req.query,
      body: req.body,
      sessionId: req.body?.sessionId || req.query?.sessionId
    });

    // Capture the original send method
    const originalSend = res.send;
    res.send = function(data) {
      const responseTimestamp = new Date().toISOString();
      console.log(`[${responseTimestamp}] [BlazeBackend] ${req.method} ${req.path} -> ${res.statusCode}`, {
        statusCode: res.statusCode,
        responseData: typeof data === 'string' ? data.substring(0, 200) + '...' : data
      });
      return originalSend.call(this, data);
    };

    next();
  });

  // Logging control endpoint
  app.post("/api/logging", (req, res) => {
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: "enabled must be a boolean"
      });
    }

    loggingEnabled = enabled;
    
    res.json({
      success: true,
      loggingEnabled,
      message: `Logging ${enabled ? 'enabled' : 'disabled'}`
    });
  });

  // Get logging status endpoint
  app.get("/api/logging", (req, res) => {
    res.json({
      success: true,
      loggingEnabled
    });
  });

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
      await currentSession.emulator.as(name, async (blaze: any, addr: any) => {
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
        let realTransactionId: string = "";
        await currentSession.emulator.as(fromWallet, async (blaze: any, addr: any) => {
          // Create a proper TransactionOutput object
          const output = new Core.TransactionOutput(toAddress, makeValue(BigInt(amount)));
          const tx = blaze.newTransaction().addOutput(output);
          
          // Extract real transaction ID before submission
          const completed = await tx.complete();
          realTransactionId = completed.getId();
          
          // Submit the transaction to emulator
          await currentSession.emulator.expectValidTransaction(blaze, tx);
        
        // Mark session as having processed transactions
        currentSession.hasProcessedTransactions = true;
          
          // Mark session as having processed transactions
          currentSession.hasProcessedTransactions = true;
        });

      res.json({
        success: true,
        fromWallet,
        toWallet,
        amount,
        transactionId: realTransactionId
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

  app.get("/api/emulator/current-time", async (req, res) => {
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
      const emulator = currentSession.emulator;
      const currentSlot = emulator.clock.slot;
      
      // Get emulator's actual time state (not real system time)
      const currentUnixTime = emulator.slotToUnix(currentSlot);
      
      res.json({
        success: true,
        currentSlot: currentSlot,
        currentUnixTime: currentUnixTime
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to get current time"
      });
    }
  });

  app.post("/api/emulator/advance-time", async (req, res) => {
    const { sessionId, targetUnixTime } = req.body;
    
    // Validate session ID
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }
    
    try {
      const emulator = currentSession.emulator;
      const initialSlot = emulator.clock.slot;
      
      // Use direct time advancement (efficient approach)
      emulator.stepForwardToUnix(targetUnixTime);
      
      const finalSlot = emulator.clock.slot;
      const slotsAdvanced = finalSlot - initialSlot;
      
      res.json({
        success: true,
        newSlot: finalSlot,
        slotsAdvanced: slotsAdvanced
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: "Failed to advance time"
      });
    }
  });

  app.post("/api/utxo/create", async (req, res) => {
    const { sessionId, address, amount, datum, referenceScript } = req.body;
    
    // Validate session ID
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }
    
    // Check phase: can only create UTXOs before transactions
    if (currentSession.hasProcessedTransactions) {
      return res.status(400).json({
        success: false,
        error: "Cannot create UTXOs after transactions have been processed"
      });
    }
    
    try {
      const emulator = currentSession.emulator;
      
      // Follow SundaeSwap pattern exactly (use unique transaction IDs to avoid conflicts)
      const utxoCount = emulator.utxos().length;
      const txId = Core.TransactionId(utxoCount.toString().repeat(64).substring(0, 64));
      const outputIndex = 0n;
      
      const output = new Core.TransactionOutput(
        Core.Address.fromBech32(address),
        makeValue(BigInt(amount))
      );
      
      // Add datum if provided (simple integer datum serialized properly)
      if (datum !== undefined) {
        // Use Data.serialize with BigInt type for proper datum serialization (following SundaeSwap pattern)
        output.setDatum(Core.Datum.newInlineData(Data.serialize(Data.BigInt(), BigInt(datum))));
      }
      
      // Add reference script if provided
      if (referenceScript) {
        const { cborToScript } = require("@blaze-cardano/uplc");
        const script = cborToScript(referenceScript, "PlutusV3");
        output.setScriptRef(script);
      }
      
      const utxo = new Core.TransactionUnspentOutput(
        new Core.TransactionInput(txId, outputIndex),
        output
      );
      
      emulator.addUtxo(utxo);
      
      res.json({
        success: true,
        utxo: {
          txHash: txId.toString(),
          outputIndex: Number(outputIndex),
          address: address,
          amount: amount,
          datum: datum
        }
      });
    } catch (error) {
      console.error("UTXO creation error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create UTXO: " + (error as Error).message
      });
    }
  });

  app.get("/api/wallet/:walletName/balance", async (req, res) => {
    const { walletName } = req.params;
    const { sessionId } = req.query;
    
    // Validate session ID
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }

    // Check if wallet exists
    if (!currentSession.emulator.mockedWallets.has(walletName)) {
      return res.status(400).json({
        success: false,
        error: `Wallet '${walletName}' does not exist`
      });
    }

    try {
      // Use existing balance calculation pattern from register endpoint
      let actualBalance = 0n;
      await currentSession.emulator.as(walletName, async (blaze: any, addr: any) => {
        const utxos = await blaze.provider.getUnspentOutputs(addr);
        actualBalance = utxos.reduce((total: bigint, utxo: any) => total + utxo.output().amount().coin(), 0n);
      });

      res.json({
        success: true,
        balance: actualBalance.toString()
      });
    } catch (error) {
      console.log("Balance query error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to query wallet balance"
      });
    }
  });

  app.get("/api/contract/:scriptHash/balance", async (req, res) => {
    const { scriptHash } = req.params;
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
      let contractAddress: any;
      
      if (currentSession.deployedContracts.has(scriptHash)) {
        // Legacy approach: use deployed contract
        const contractInfo = currentSession.deployedContracts.get(scriptHash);
        contractAddress = contractInfo.address;
      } else {
        // Modern approach: compute address directly from script hash
        // We need to recreate the script to get the address
        // For now, return error since we can't compute address without compiled code
        return res.status(400).json({
          success: false,
          error: `Cannot query balance for script hash '${scriptHash}' without compiled code. Either deploy the contract first or use a different endpoint that provides compiled code.`
        });
      }

      // Use any wallet to query the contract address
      const walletName = Array.from(currentSession.emulator.mockedWallets.keys())[0];
      let contractBalance = 0n;
      
      await currentSession.emulator.as(walletName, async (blaze: any, addr: any) => {
        const utxos = await blaze.provider.getUnspentOutputs(contractAddress);
        contractBalance = utxos.reduce((total: bigint, utxo: any) => total + utxo.output().amount().coin(), 0n);
      });

      res.json({
        success: true,
        balance: contractBalance.toString()
      });
    } catch (error) {
      console.log("Contract balance query error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to query contract balance"
      });
    }
  });

  // Helper function to find a specific UTXO by transaction hash and output index
  async function findUtxo(blaze: any, txHash: string, outputIndex: number, contractAddresses?: any[]): Promise<any> {
    // Search wallet UTXOs first
    const walletAddress = blaze.wallet.address;
    const walletUtxos = await blaze.provider.getUnspentOutputs(walletAddress);
    
    for (const utxo of walletUtxos) {
      if (utxo.input().transactionId().toString() === txHash && 
          Number(utxo.input().index()) === outputIndex) {
        return utxo;
      }
    }
    
    // Search contract UTXOs if provided
    if (contractAddresses) {
      for (const contractAddr of contractAddresses) {
        const contractUtxos = await blaze.provider.getUnspentOutputs(contractAddr);
        for (const utxo of contractUtxos) {
          if (utxo.input().transactionId().toString() === txHash && 
              Number(utxo.input().index()) === outputIndex) {
            return utxo;
          }
        }
      }
    }
    
    throw new Error(`UTXO not found: ${txHash}:${outputIndex}`);
  }

  // Helper function to get script for a contract address
  function getScriptForAddress(contractAddress: string, deployedContracts: Map<string, any>): any {
    // Find deployed contract by address
    for (const [name, info] of deployedContracts.entries()) {
      if (info.address.toBech32() === contractAddress) {
        return cborToScript(info.compiledCode, "PlutusV3");
      }
    }
    throw new Error(`No script found for contract address: ${contractAddress}`);
  }

  app.post("/api/transaction/build-and-submit", async (req, res) => {
    const { sessionId, signerWallet, operations, collateralUtxos } = req.body;
    
    // Validate session ID
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }

    // Basic validation
    if (!signerWallet || !operations || !Array.isArray(operations)) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameters"
      });
    }

    try {
      // Execute real transaction using Blaze
      await currentSession.emulator.as(signerWallet, async (blaze: any, addr: any) => {
        let tx = blaze.newTransaction();
        
        // Add specific collateral UTXOs if provided (following SundaeSwap pattern)
        if (collateralUtxos && Array.isArray(collateralUtxos)) {
          const collateralList = [];
          for (const collateralRef of collateralUtxos) {
            const collateralUtxo = await findUtxo(blaze, collateralRef.txHash, collateralRef.outputIndex);
            collateralList.push(collateralUtxo);
          }
          tx = tx.provideCollateral(collateralList);
        }

        // Process each operation
        for (const operation of operations) {
          switch (operation.type) {
            case "spend-from-wallet":
              // Add specific wallet as input source (Blaze will handle UTXO selection)
              // For now, we'll let Blaze automatically select UTXOs from the signer wallet
              // The amount specification helps with validation but Blaze handles the actual selection
              break;

            case "spend-specific-utxos":
              // Following SundaeSwap pattern: manually select specific UTXOs instead of automatic coin selection
              if (operation.utxos && Array.isArray(operation.utxos)) {
                for (const utxoRef of operation.utxos) {
                  const specificUtxo = await findUtxo(blaze, utxoRef.txHash, utxoRef.outputIndex);
                  tx = tx.addInput(specificUtxo);
                }
              }
              break;

            case "spend-utxo":
              // Find specific UTXO by txHash + outputIndex
              const utxo = await findUtxo(blaze, operation.txHash, operation.outputIndex);
              tx = tx.addInput(utxo);
              break;

            case "unlock-utxo":
              // Find contract UTXO and unlock it with redeemer
              let contractAddresses = Array.from(currentSession.deployedContracts.values()).map((info: any) => info.address);
              
              // If compiledCode is provided, add the computed script address for UTXO discovery
              if (operation.compiledCode) {
                // Use efficient script lookup that leverages blueprint cache
                const { script } = computeScriptInfo(operation.compiledCode);
                const scriptAddress = Core.addressFromValidator(Core.NetworkId.Testnet, script);
                contractAddresses.push(scriptAddress);
              }
              
              const scriptUtxo = await findUtxo(blaze, operation.txHash, operation.outputIndex, contractAddresses);
              
              // Add input with redeemer
              tx = tx.addInput(scriptUtxo, Data.serialize(Data.BigInt(), BigInt(operation.redeemer)));
              
              // Handle script reference: either reference script OR inline script (CIP-33)
              if (operation.referenceScriptUtxo) {
                // Use reference script from another UTXO (true CIP-33)
                // Following SundaeSwap pattern: find the UTXO but add as reference input only
                const refScriptUtxo = await findUtxo(blaze, operation.referenceScriptUtxo.txHash, operation.referenceScriptUtxo.outputIndex);
                
                // Add reference input - this provides the script WITHOUT consuming the UTXO
                tx = tx.addReferenceInput(refScriptUtxo);
                
                // CRITICAL: Do NOT call provideScript when using reference scripts
                // The reference input provides the script automatically for validation
                
              } else if (operation.script) {
                // Use inline script (backward compatibility)
                const script = cborToScript(operation.script, "PlutusV3");
                tx = tx.provideScript(script);
              } else if (operation.compiledCode) {
                // Modern approach: use compiled code directly (following pay-to-contract pattern)
                const script = cborToScript(operation.compiledCode, "PlutusV3");
                tx = tx.provideScript(script);
              } else {
                // Fallback: Get script from contract address (existing behavior)
                const utxoAddress = scriptUtxo.output().address().toBech32();
                const script = getScriptForAddress(utxoAddress, currentSession.deployedContracts);
                tx = tx.provideScript(script);
              }
              break;
              
            case "pay-to-address":
              if (operation.referenceScript) {
                // Create output with reference script using setScriptRef method
                const script = cborToScript(operation.referenceScript, "PlutusV3");
                const address = Core.addressFromBech32(operation.address);
                const amount = makeValue(BigInt(operation.amount));
                
                // Create output first, then attach script reference
                const output = new Core.TransactionOutput(address, amount);
                output.setScriptRef(script);
                
                tx = tx.addOutput(output);
              } else {
                // Regular output without reference script
                const output = new Core.TransactionOutput(
                  Core.addressFromBech32(operation.address),
                  makeValue(BigInt(operation.amount))
                );
                tx = tx.addOutput(output);
              }
              break;
              
            case "pay-to-contract":
              let scriptAddress: any;
              
              if (currentSession.deployedContracts.has(operation.scriptHash)) {
                // Legacy compatibility: use deployed contract if available
                const contractInfo: any = currentSession.deployedContracts.get(operation.scriptHash);
                scriptAddress = contractInfo.address;
              } else {
                if (!operation.compiledCode) {
                  throw new Error(`Script hash provided without compiled code. Either use deployed contract or provide compiledCode in operation.`);
                }
                
                const { script, scriptHash: computedScriptHash, contractAddress: computedAddress } = computeScriptInfo(operation.compiledCode);
                
                if (computedScriptHash !== operation.scriptHash) {
                  throw new Error(`Script hash mismatch. Provided: ${operation.scriptHash}, Computed: ${computedScriptHash}`);
                }
                
                scriptAddress = Core.addressFromBech32(computedAddress);
              }
              
              let serializedDatum = operation.datum;
              if (typeof operation.datum === 'number') {
                serializedDatum = Data.serialize(MyDatum, { thing: BigInt(operation.datum) });
              }
              
              let referenceScript = undefined;
              if (operation.referenceScript) {
                referenceScript = cborToScript(operation.referenceScript, "PlutusV3");
              }
              
              tx = tx.lockAssets(
                scriptAddress,
                makeValue(BigInt(operation.amount)),
                serializedDatum,
                referenceScript
              );
              break;
              
            case "mint":
              // Convert asset name to BigInt (following SundaeSwap pattern)
              const assetNameBigInt = BigInt(operation.assetName);
              const amount = BigInt(operation.amount);
              
              // Create assets map for the mint operation
              const assetsMap = new Map([[assetNameBigInt, amount]]);
              
              // Handle redeemer if provided
              let redeemer = undefined;
              if (operation.redeemer) {
                redeemer = Data.serialize(Data.BigInt(), BigInt(operation.redeemer));
              }
              
              // Add the mint operation
              tx = tx.addMint(operation.policyId, assetsMap, redeemer);
              
              // If reference script is provided, add it as reference input
              if (operation.referenceScriptUtxo) {
                const refScriptUtxo = await findUtxo(blaze, operation.referenceScriptUtxo.txHash, operation.referenceScriptUtxo.outputIndex);
                tx = tx.addReferenceInput(refScriptUtxo);
              }
              break;
              
            default:
              throw new Error(`Unsupported operation type: ${operation.type}`);
          }
        }

        // Extract real transaction ID before submission
        const completed = await tx.complete();
        const realTransactionId = completed.getId();

        // Extract created UTXOs for reference
        const coreTransaction = completed.toCore();
        const outputs = coreTransaction.body.outputs;
        const createdUtxos = outputs.map((output: any, index: number) => ({
          txHash: realTransactionId,
          outputIndex: index,
          address: output.address, // Already in bech32 format
          amount: output.value.coins.toString() // Convert bigint to string
        }));

        // Submit the transaction to emulator
        await currentSession.emulator.expectValidTransaction(blaze, tx);
        
        // Mark session as having processed transactions
        currentSession.hasProcessedTransactions = true;

        res.json({
          success: true,
          transactionId: realTransactionId,
          operationsExecuted: operations.length,
          createdUtxos // Add UTXO references for direct use
        });
      });
    } catch (error) {
      console.log("Transaction build error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to build and submit transaction"
      });
    }
  });

  app.get("/api/wallet/:walletName/utxos", async (req, res) => {
    const { walletName } = req.params;
    const { sessionId } = req.query;
    
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }

    if (!currentSession.emulator.mockedWallets.has(walletName)) {
      return res.status(400).json({
        success: false,
        error: `Wallet '${walletName}' does not exist`
      });
    }
    
    try {
      await currentSession.emulator.as(walletName, async (blaze: any, addr: any) => {
        const utxos = await blaze.provider.getUnspentOutputs(addr);
        
        const formattedUtxos = utxos.map((utxo: any) => ({
          txHash: utxo.input().transactionId().toString(),
          outputIndex: Number(utxo.input().index()),
          address: utxo.output().address().toBech32(),
          amount: utxo.output().amount().coin().toString(),
          assets: {}, // TODO: implement extractAssets helper
          datum: null // TODO: implement extractDatum helper
        }));
        
        res.json({
          success: true,
          utxos: formattedUtxos
        });
      });
    } catch (error) {
      console.log("UTXO discovery error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to discover UTXOs"
      });
    }
  });

  app.get("/api/contract/:contractAddress/utxos", async (req, res) => {
    const { contractAddress } = req.params;
    const { sessionId } = req.query;
    
    console.log(`[Contract UTXOs] Request for address: ${contractAddress}, session: ${sessionId}`);
    
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      console.log(`[Contract UTXOs] Invalid session ID: ${sessionId}, current: ${currentSession?.id}`);
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }
    
    try {
      console.log(`[Contract UTXOs] Parsing address: ${contractAddress}`);
      const scriptAddress = Core.addressFromBech32(contractAddress);
      console.log(`[Contract UTXOs] Address parsed successfully`);
      
      // Use any wallet to query the contract address
      const walletName = Array.from(currentSession.emulator.mockedWallets.keys())[0];
      console.log(`[Contract UTXOs] Using wallet: ${walletName}`);
      
      await currentSession.emulator.as(walletName, async (blaze: any, addr: any) => {
        console.log(`[Contract UTXOs] Getting unspent outputs for script address`);
        const utxos = await blaze.provider.getUnspentOutputs(scriptAddress);
        console.log(`[Contract UTXOs] Found ${utxos.length} UTXOs`);
        
        const formattedUtxos = utxos.map((utxo: any) => {
          const output = utxo.output();
          const datum = output.datum();
          
          return {
            txHash: utxo.input().transactionId().toString(),
            outputIndex: Number(utxo.input().index()),
            address: output.address().toBech32(),
            amount: output.amount().coin().toString(),
            assets: {}, // TODO: implement extractAssets helper
            datum: extractSimpleDatum(datum), // Extract datum for contract UTXOs
            datumHash: getDatumHash(datum) // Extract datum hash
          };
        });
        
        console.log(`[Contract UTXOs] Sending response with ${formattedUtxos.length} UTXOs`);
        res.json({
          success: true,
          utxos: formattedUtxos
        });
      });
    } catch (error) {
      console.log("[Contract UTXOs] Error:", error);
      console.log("[Contract UTXOs] Error stack:", error instanceof Error ? error.stack : 'No stack trace');
      res.status(500).json({
        success: false,
        error: "Failed to discover contract UTXOs",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Helper function to extract simple datum values
  function extractSimpleDatum(datum: any): any {
    if (!datum) return null;
    
    try {
      if (datum.kind() === 1) { // Check if it's inline data
        const inlineData = datum.asInlineData();
        
        // Try as direct bytes first (Data.serialize creates bytes representation)
        if (inlineData.getKind() === 3) { // Bytes
          const cbor = inlineData.toCbor();
          
          // CBOR decoding for unsigned integers:
          // 0x00-0x17: Small integers 0-23 (direct encoding)
          // 0x18 + byte: Integers 24-255
          // 0x19 + 2 bytes: Integers 256-65535
          // 0x1a + 4 bytes: Integers 65536-4294967295
          
          if (cbor.length === 2) {
            // Single byte integer (0-23)
            const value = parseInt(cbor, 16);
            if (value >= 0 && value <= 23) {
              return value;
            }
          } else if (cbor.length === 4 && cbor.startsWith("18")) {
            // 0x18 followed by 1-byte value (24-255)
            const value = parseInt(cbor.substring(2), 16);
            return value;
          } else if (cbor.length === 6 && cbor.startsWith("19")) {
            // 0x19 followed by 2-byte value (256-65535)
            const value = parseInt(cbor.substring(2), 16);
            return value;
          } else if (cbor.length === 10 && cbor.startsWith("1a")) {
            // 0x1a followed by 4-byte value
            const value = parseInt(cbor.substring(2), 16);
            return value;
          }
          
          // Unsupported CBOR format
          console.log("Unsupported CBOR format for datum:", cbor);
          return null;
        }
        
        // Try to extract as constructor data (our MyDatum is a record/constructor)
        if (inlineData.getKind() === 0) { // Constructor
          const constrData = inlineData.asConstrPlutusData();
          const fields = constrData.getData();
          
          if (fields && fields.getLength() > 0) {
            const firstField = fields.get(0);
            if (firstField.getKind() === 2) { // Integer
              const integer = firstField.asInteger();
              return Number(integer.asPositive());
            } else if (firstField.getKind() === 3) { // Bytes 
              const cbor = firstField.toCbor();
              
              // CBOR decoding for unsigned integers:
              // 0x00-0x17: Small integers 0-23 (direct encoding)
              // 0x18 + byte: Integers 24-255
              // 0x19 + 2 bytes: Integers 256-65535
              // 0x1a + 4 bytes: Integers 65536-4294967295
              
              if (cbor.length === 2) {
                // Single byte integer (0-23)
                const value = parseInt(cbor, 16);
                if (value >= 0 && value <= 23) {
                  return value;
                }
              } else if (cbor.length === 4 && cbor.startsWith("18")) {
                // 0x18 followed by 1-byte value (24-255)
                const value = parseInt(cbor.substring(2), 16);
                return value;
              } else if (cbor.length === 6 && cbor.startsWith("19")) {
                // 0x19 followed by 2-byte value (256-65535)
                const value = parseInt(cbor.substring(2), 16);
                return value;
              } else if (cbor.length === 10 && cbor.startsWith("1a")) {
                // 0x1a followed by 4-byte value
                const value = parseInt(cbor.substring(2), 16);
                return value;
              }
              
              // Unsupported CBOR format
              console.log("Unsupported CBOR format for datum:", cbor);
              return null;
            }
          }
        }
        
        // Try as direct integer
        if (inlineData.getKind() === 2) { // Integer
          return Number(inlineData.asInteger().asPositive());
        }
      }
      return null; // Hash-only datum
    } catch (error) {
      console.log("Datum extraction error:", error);
      return null;
    }
  }

  // Helper function to get datum hash
  function getDatumHash(datum: any): string | null {
    if (!datum) return null;
    
    try {
      if (datum.kind() === 0) { // Hash-only datum
        return datum.asDataHash().toString();
      }
      if (datum.kind() === 1) { // Inline datum
        const inlineData = datum.asInlineData();
        const hash = inlineData.hash();
        return hash.toString();
      }
      return null;
    } catch (error) {
      console.log("DatumHash extraction error:", error);
      return null;
    }
  }



  return new Promise((resolve, reject) => {
    const port = process.env.PORT || 3031;
    const server = app.listen(port, () => {
      resolve(server);
    });
    
  // Handle port-in-use and other server errors
  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      reject(new Error(`Port ${port} is already in use`));
    } else {
      reject(err);
    }
  });
});
}