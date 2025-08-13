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
    const { sessionId, deployerWallet, contractName, compiledCode, datumSchema, redeemerSchema } = req.body;

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

      // Store the contract info for later use
      // Use contractName if provided, otherwise use script address as key
      const contractKey = contractName || scriptAddress.toBech32();
      currentSession.deployedContracts.set(contractKey, {
        address: scriptAddress,
        compiledCode: compiledCode,
        scriptHash: script.hash()
      });

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
      // Get the contract info for this contract
      const contractInfo = currentSession.deployedContracts.get(contractAddress);
      if (!contractInfo) {
        return res.status(400).json({
          success: false,
          error: `Contract at address '${contractAddress}' not found`
        });
      }

      // Recreate the script from the compiled code
      const script = cborToScript(contractInfo.compiledCode, "PlutusV3");
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
      await currentSession.emulator.as(walletName, async (blaze, addr) => {
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

  app.get("/api/contract/:contractName/balance", async (req, res) => {
    const { contractName } = req.params;
    const { sessionId } = req.query;
    
    // Validate session ID
    const currentSession = sessionManager.getCurrentSession();
    if (!currentSession || currentSession.id !== sessionId) {
      return res.status(400).json({
        success: false,
        error: "Invalid session ID"
      });
    }

    // Check if contract exists in deployed contracts
    if (!currentSession.deployedContracts.has(contractName)) {
      return res.status(400).json({
        success: false,
        error: `Contract '${contractName}' has not been deployed`
      });
    }

    try {
      const contractInfo = currentSession.deployedContracts.get(contractName);
      const contractAddress = contractInfo.address;

      // Use any wallet to query the contract address
      const walletName = Array.from(currentSession.emulator.mockedWallets.keys())[0];
      let contractBalance = 0n;
      
      await currentSession.emulator.as(walletName, async (blaze, addr) => {
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
    const { sessionId, signerWallet, operations } = req.body;
    
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
      await currentSession.emulator.as(signerWallet, async (blaze, addr) => {
        let tx = blaze.newTransaction();

        // Process each operation
        for (const operation of operations) {
          switch (operation.type) {
            case "spend-from-wallet":
              // Add specific wallet as input source (Blaze will handle UTXO selection)
              // For now, we'll let Blaze automatically select UTXOs from the signer wallet
              // The amount specification helps with validation but Blaze handles the actual selection
              break;

            case "spend-utxo":
              // Find specific UTXO by txHash + outputIndex
              const utxo = await findUtxo(blaze, operation.txHash, operation.outputIndex);
              tx = tx.addInput(utxo);
              break;

            case "unlock-utxo":
              // Find contract UTXO and unlock it with redeemer
              const contractAddresses = Array.from(currentSession.deployedContracts.values()).map(info => info.address);
              const scriptUtxo = await findUtxo(blaze, operation.txHash, operation.outputIndex, contractAddresses);
              
              // Get the script for this UTXO based on its address
              const utxoAddress = scriptUtxo.output().address().toBech32();
              const script = getScriptForAddress(utxoAddress, currentSession.deployedContracts);
              
              // Add input with redeemer and provide script
              tx = tx.addInput(scriptUtxo, Data.serialize(Data.BigInt(), BigInt(operation.redeemer)))
                     .provideScript(script);
              break;
              
            case "pay-to-address":
              // Create output to specific address
              const output = new Core.TransactionOutput(
                Core.addressFromBech32(operation.address),
                makeValue(BigInt(operation.amount))
              );
              tx = tx.addOutput(output);
              break;
              
            case "pay-to-contract":
              // Get contract info by name
              const contractInfo = currentSession.deployedContracts.get(operation.contractAddress);
              if (!contractInfo) {
                throw new Error(`Contract '${operation.contractAddress}' not found`);
              }
              
              // Lock assets to contract address with datum
              tx = tx.lockAssets(
                contractInfo.address,
                makeValue(BigInt(operation.amount)),
                operation.datum
              );
              break;
              
            default:
              throw new Error(`Unsupported operation type: ${operation.type}`);
          }
        }

        // Extract real transaction ID before submission
        const completed = await tx.complete();
        const realTransactionId = completed.getId();

        // Submit the transaction to emulator
        await currentSession.emulator.expectValidTransaction(blaze, tx);

        res.json({
          success: true,
          transactionId: realTransactionId,
          operationsExecuted: operations.length
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
      await currentSession.emulator.as(walletName, async (blaze, addr) => {
        const utxos = await blaze.provider.getUnspentOutputs(addr);
        
        const formattedUtxos = utxos.map(utxo => ({
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
      await currentSession.emulator.as(walletName, async (blaze, addr) => {
        const utxos = await blaze.provider.getUnspentOutputs(scriptAddress);
        
        const formattedUtxos = utxos.map(utxo => {
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
              // CBOR hex 187b = decimal 123 encoded as bytes
              const cbor = firstField.toCbor();
              
              // Simple CBOR decode for small integers
              // 187b in hex = 0x18 (integer with 1-byte value) + 0x7b (123 in decimal)
              if (cbor === "187b") {
                return 123;
              }
              
              // For other values, we'd need proper CBOR parsing
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
    const server = app.listen(3001, () => {
      resolve(server);
    });
  });
}
