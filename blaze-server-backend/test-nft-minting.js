#!/usr/bin/env node

/**
 * Simple test for NFT minting functionality
 */

const { MonadicRuntime } = require('./dist/demo-interpreter/monadic/runtime.js');

async function testNFTMinting() {
  console.log('🧪 Testing NFT Minting Functionality...\n');
  
  // Create runtime
  const runtime = new MonadicRuntime({
    baseUrl: 'http://localhost:3041',
    debug: true
  });
  
  try {
    // Initialize session
    console.log('1. Initializing session...');
    await runtime.initialize();
    console.log('✅ Session initialized\n');
    
    // Create wallet
    console.log('2. Creating wallet...');
    const wallet = await runtime.createWallet('alice', 20_000_000);
    console.log(`✅ Wallet created: ${wallet.name} with ${wallet.balance} lovelace\n`);
    
    // Deploy minting policy (using createReferenceScript)
    console.log('3. Deploying minting policy...');
    const policyDeployment = await runtime.createReferenceScript('hello_world', {
      wallet: 'alice',
      blueprint: './plutus.json'
    });
    console.log(`✅ Policy deployed!`);
    console.log(`   Policy ID: ${policyDeployment.scriptHash}`);
    console.log(`   Contract Address: ${policyDeployment.contractAddress}`);
    console.log(`   Ref Script UTXO: ${policyDeployment.refScriptUtxo.txHash}:${policyDeployment.refScriptUtxo.outputIndex}\n`);
    
    // Mint NFT
    console.log('4. Minting NFT...');
    const nftResult = await runtime.mintNFT(
      policyDeployment.scriptHash,
      '001',
      1,
      policyDeployment.refScriptUtxo,
      { wallet: 'alice' }
    );
    console.log(`✅ NFT minted successfully!`);
    console.log(`   Transaction ID: ${nftResult.transactionId}`);
    console.log(`   Policy ID: ${nftResult.policyId}`);
    console.log(`   Asset Name: ${nftResult.assetName}`);
    console.log(`   Amount: ${nftResult.amount}\n`);
    
    // Check final balance
    console.log('5. Checking final balance...');
    const finalBalance = await runtime.getBalance('alice');
    console.log(`✅ Final balance: ${finalBalance} lovelace\n`);
    
    console.log('🎉 NFT minting test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await runtime.cleanup();
  }
}

// Run the test
testNFTMinting().catch(console.error);
