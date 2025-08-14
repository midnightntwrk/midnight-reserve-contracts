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

  // ✅ DEPRECATED ENDPOINT REMOVED: /api/contract/deploy
  // Modern approach: Use computeScriptInfo() utility and build-and-submit transactions

  // ✅ DEPRECATED ENDPOINT REMOVED: /api/contract/lock
  // Modern approach: Use pay-to-contract operation in build-and-submit transactions

  // ✅ DEPRECATED ENDPOINT REMOVED: /api/contract/invoke
  // Modern approach: Use unlock-utxo operation in build-and-submit transactions

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
              // Modern approach: compute script address directly from script hash (following SundaeSwap pattern)
              // This eliminates the need for artificial "deployment" - true to Cardano's design
              
              let scriptAddress: any;
              
              if (currentSession.deployedContracts.has(operation.contractAddress)) {
                // Legacy compatibility: use deployed contract if available
                const contractInfo: any = currentSession.deployedContracts.get(operation.contractAddress);
                scriptAddress = contractInfo.address;
              } else {
                // Modern approach: operation.contractAddress is a script hash hex string
                // We need to reconstruct the script to get the proper address (following existing deploy pattern)
                // This requires the compiled code to be passed in the operation
                
                if (!operation.compiledCode) {
                  throw new Error(`Script hash provided without compiled code. Either use deployed contract or provide compiledCode in operation.`);
                }
                
                // Use efficient script lookup that leverages blueprint cache
                const { script, scriptHash: computedScriptHash, contractAddress: computedAddress } = computeScriptInfo(operation.compiledCode);
                
                // Verify the provided script hash matches the computed one
                if (computedScriptHash !== operation.contractAddress) {
                  throw new Error(`Script hash mismatch. Provided: ${operation.contractAddress}, Computed: ${computedScriptHash}`);
                }
                
                // Use precomputed address from blueprint cache
                scriptAddress = Core.addressFromBech32(computedAddress);
              }
              
              // Lock assets to contract address with datum
              // If datum is a number, serialize it as MyDatum
              let serializedDatum = operation.datum;
              if (typeof operation.datum === 'number') {
                serializedDatum = Data.serialize(MyDatum, { thing: BigInt(operation.datum) });
              }
              
              // Support reference script for pay-to-contract
              let referenceScript = undefined;
              if (operation.referenceScript) {
                referenceScript = cborToScript(operation.referenceScript, "PlutusV3");
              }
              
              tx = tx.lockAssets(
                scriptAddress,
                makeValue(BigInt(operation.amount)),
                serializedDatum,
                referenceScript // Reference script as 4th parameter
              );
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
    
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }
    
    try {
      const scriptAddress = Core.addressFromBech32(contractAddress);
      
      // Use any wallet to query the contract address
      const walletName = Array.from(currentSession.emulator.mockedWallets.keys())[0];
      await currentSession.emulator.as(walletName, async (blaze: any, addr: any) => {
        const utxos = await blaze.provider.getUnspentOutputs(scriptAddress);
        
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
        
        res.json({
          success: true,
          utxos: formattedUtxos
        });
      });
    } catch (error) {
      console.log("Contract UTXO discovery error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to discover contract UTXOs"
      });
    }
  });

  // Helper function to extract simple datum values
  function extractSimpleDatum(datum: any): any {
    if (!datum) return null;
    
    try {
      if (datum.kind() === 1) { // Check if it's inline data
        const inlineData = datum.asInlineData();
        
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

  return new Promise((resolve) => {
    const server = app.listen(3031, () => {
      resolve(server);
    });
  });
}
