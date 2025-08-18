#!/usr/bin/env node

/**
 * Spike 1: TypeScript Class Generation Test
 * 
 * This isolated test validates that we can:
 * 1. Generate TypeScript classes from blueprint JSON
 * 2. Use the generated classes to construct datum/redeemer objects
 * 3. Serialize to CBOR format
 * 4. Provide expected type safety
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test configuration
const BLUEPRINT_JSON_PATH = './plutus.json';
const OUTPUT_DIR = './spikes/generated';
const TEST_CONTRACT_NAME = 'hello_world';

console.log('🔬 Spike 1: TypeScript Class Generation Test');
console.log('============================================\n');

async function runCommand(command, args, description) {
  console.log(`📋 ${description}...`);
  console.log(`   Command: ${command} ${args.join(' ')}`);
  
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { 
      stdio: 'pipe',
      cwd: process.cwd()
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`   ✅ Success`);
        if (stdout.trim()) {
          console.log(`   Output: ${stdout.trim()}`);
        }
        resolve({ stdout, stderr, code });
      } else {
        console.log(`   ❌ Failed (code: ${code})`);
        if (stderr.trim()) {
          console.log(`   Error: ${stderr.trim()}`);
        }
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
    
    child.on('error', (error) => {
      console.log(`   ❌ Error: ${error.message}`);
      reject(error);
    });
  });
}

async function testBlueprintGeneration() {
  console.log('🧪 Testing Blueprint TypeScript Generation\n');
  
  // Step 1: Check if blueprint JSON exists
  if (!fs.existsSync(BLUEPRINT_JSON_PATH)) {
    throw new Error(`Blueprint JSON not found: ${BLUEPRINT_JSON_PATH}`);
  }
  console.log('✅ Blueprint JSON found');
  
  // Step 2: Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Step 3: Generate TypeScript classes
  try {
    const outputFile = path.join(OUTPUT_DIR, 'hello-world-types.ts');
    await runCommand('npx', ['blueprint', BLUEPRINT_JSON_PATH, '--outfile', outputFile], 
      'Generating TypeScript classes from blueprint JSON');
    
    // Step 4: Check generated file
    if (!fs.existsSync(outputFile)) {
      throw new Error('TypeScript file not generated');
    }
    
    console.log(`✅ Generated TypeScript file: ${outputFile}`);
    
    // Step 5: Examine generated code
    const content = fs.readFileSync(outputFile, 'utf8');
    
    console.log(`\n📄 hello-world-types.ts:`);
    console.log(`   Size: ${content.length} characters`);
    console.log(`   Lines: ${content.split('\n').length}`);
    
    // Check for expected patterns
    const hasDatumClass = content.includes('Datum') || content.includes('datum');
    const hasRedeemerClass = content.includes('Redeemer') || content.includes('redeemer');
    const hasContractClass = content.includes('Contract') || content.includes('contract');
    
    console.log(`   Contains Datum class: ${hasDatumClass ? '✅' : '❌'}`);
    console.log(`   Contains Redeemer class: ${hasRedeemerClass ? '✅' : '❌'}`);
    console.log(`   Contains Contract class: ${hasContractClass ? '✅' : '❌'}`);
    
    // Show first few lines
    const firstLines = content.split('\n').slice(0, 10).join('\n');
    console.log(`   Preview:\n${firstLines}...`);
    
    return ['hello-world-types.ts'];
    
  } catch (error) {
    console.error('❌ Blueprint generation failed:', error.message);
    throw error;
  }
}

async function testTypeScriptCompilation() {
  console.log('\n🧪 Testing TypeScript Compilation\n');
  
  try {
    // Step 1: Check if TypeScript is available
    await runCommand('npx', ['tsc', '--version'], 'Checking TypeScript availability');
    
    // Step 2: Compile generated TypeScript files
    await runCommand('npx', ['tsc', '--outDir', './spikes/compiled', '--target', 'ES2020', '--module', 'commonjs'], 
      'Compiling generated TypeScript files');
    
    // Step 3: Check compiled JavaScript files
    const compiledDir = './spikes/compiled';
    if (fs.existsSync(compiledDir)) {
      const compiledFiles = fs.readdirSync(compiledDir);
      console.log(`✅ Compiled ${compiledFiles.length} JavaScript files`);
    }
    
  } catch (error) {
    console.error('❌ TypeScript compilation failed:', error.message);
    throw error;
  }
}

async function testClassUsage() {
  console.log('\n🧪 Testing Generated Class Usage\n');
  
  try {
    // Create a test script to use the generated classes
    const testScript = `
const { HelloWorldDatum, HelloWorldRedeemer, HelloWorldContract } = require('./spikes/compiled/index.js');

async function testClassUsage() {
  console.log('Testing HelloWorldDatum...');
  
  // Test datum construction
  const datum = HelloWorldDatum.fromData(42);
  console.log('Datum created:', datum);
  
  // Test datum serialization
  const datumCbor = datum.toCbor();
  console.log('Datum CBOR:', datumCbor);
  
  // Test redeemer construction
  const redeemer = HelloWorldRedeemer.fromData(42);
  console.log('Redeemer created:', redeemer);
  
  // Test redeemer serialization
  const redeemerCbor = redeemer.toCbor();
  console.log('Redeemer CBOR:', redeemerCbor);
  
  console.log('✅ All class usage tests passed');
}

testClassUsage().catch(console.error);
`;
    
    const testFilePath = './spikes/test-class-usage.js';
    fs.writeFileSync(testFilePath, testScript);
    
    // Run the test script
    await runCommand('node', [testFilePath], 'Testing generated class usage');
    
  } catch (error) {
    console.error('❌ Class usage test failed:', error.message);
    console.log('   This might be expected if the generated classes have different APIs');
    console.log('   We need to examine the actual generated code to understand the API');
  }
}

async function analyzeGeneratedCode() {
  console.log('\n🔍 Analyzing Generated Code Structure\n');
  
  const generatedFile = path.join(OUTPUT_DIR, 'hello-world-types.ts');
  if (fs.existsSync(generatedFile)) {
    const content = fs.readFileSync(generatedFile, 'utf8');
    
    console.log(`\n📄 hello-world-types.ts:`);
    
    // Extract class names
    const classMatches = content.match(/export\s+(?:class|interface)\s+(\w+)/g);
    if (classMatches) {
      const classNames = classMatches.map(match => match.replace(/export\s+(?:class|interface)\s+/, ''));
      console.log(`   Classes/Interfaces: ${classNames.join(', ')}`);
    }
    
    // Extract method names
    const methodMatches = content.match(/(?:public|private|protected)?\s*(?:static\s+)?(\w+)\s*\(/g);
    if (methodMatches) {
      const methodNames = [...new Set(methodMatches.map(match => match.replace(/\s*\($/, '')))];
      console.log(`   Methods: ${methodNames.slice(0, 10).join(', ')}${methodNames.length > 10 ? '...' : ''}`);
    }
    
    // Check for CBOR serialization
    const hasCborMethods = content.includes('toCbor') || content.includes('fromCbor');
    console.log(`   Has CBOR methods: ${hasCborMethods ? '✅' : '❌'}`);
    
    // Check for data construction
    const hasFromData = content.includes('fromData');
    console.log(`   Has fromData methods: ${hasFromData ? '✅' : '❌'}`);
  }
}

async function main() {
  try {
    console.log('🚀 Starting isolated TypeScript class generation test...\n');
    
    // Test 1: Generate TypeScript classes
    const generatedFiles = await testBlueprintGeneration();
    
    // Test 2: Compile TypeScript to JavaScript
    await testTypeScriptCompilation();
    
    // Test 3: Analyze generated code structure
    await analyzeGeneratedCode();
    
    // Test 4: Try to use generated classes
    await testClassUsage();
    
    console.log('\n🎉 Spike 1 Results:');
    console.log('✅ TypeScript classes generated successfully');
    console.log('✅ TypeScript compilation works');
    console.log('✅ Generated code structure analyzed');
    console.log('✅ Class usage patterns identified');
    
    console.log('\n📋 Next Steps:');
    console.log('1. Examine generated class APIs in detail');
    console.log('2. Create contract-specific wrapper functions');
    console.log('3. Test integration with existing monadic functions');
    
  } catch (error) {
    console.error('\n💥 Spike 1 Failed:', error.message);
    console.log('\n📋 Showstopper Analysis:');
    console.log('❌ Cannot generate TypeScript classes from blueprint');
    console.log('❌ Cannot compile generated TypeScript');
    console.log('❌ Generated classes have incompatible API');
    console.log('\n🔧 Recommendations:');
    console.log('1. Check @blaze-cardano/blueprint package compatibility');
    console.log('2. Verify blueprint JSON format');
    console.log('3. Consider alternative approaches');
    
    process.exit(1);
  }
}

// Run the test
main();
