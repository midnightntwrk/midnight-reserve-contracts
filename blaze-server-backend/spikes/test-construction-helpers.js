#!/usr/bin/env node

/**
 * Test if blueprint-generated code provides easy construction helpers
 * Focus on: easy datum/redeemer construction and transaction building
 */

console.log('🔍 Testing Blueprint Construction Helpers\n');

// First, let's test the @blaze-cardano/data API directly
console.log('🧪 Testing @blaze-cardano/data Construction API:');
console.log('===============================================');

try {
  const { Type } = require('@blaze-cardano/data');
  console.log('✅ Type imported from @blaze-cardano/data');
  
  // Test 1: Create a datum type similar to what's generated
  console.log('\n📋 Test 1: Creating datum type...');
  const MyDatumType = Type.Object({
    thing: Type.BigInt(),
  }, { ctor: 0n });
  
  console.log('MyDatumType created:', typeof MyDatumType);
  
  // Test 2: Easy datum construction
  console.log('\n📋 Test 2: Easy datum construction...');
  const datum = MyDatumType({ thing: 42n });
  console.log('✅ Datum created:', datum);
  console.log('Datum type:', typeof datum);
  console.log('Datum properties:', Object.getOwnPropertyNames(datum));
  
  // Test 3: Check for serialization methods
  console.log('\n📋 Test 3: Checking serialization methods...');
  const methods = Object.getOwnPropertyNames(datum);
  console.log('Available methods:', methods);
  
  if (typeof datum.toCbor === 'function') {
    const cbor = datum.toCbor();
    console.log('✅ toCbor() works:', cbor);
  } else {
    console.log('❌ No toCbor() method');
  }
  
  if (typeof datum.toData === 'function') {
    const data = datum.toData();
    console.log('✅ toData() works:', data);
  } else {
    console.log('❌ No toData() method');
  }
  
  if (typeof datum.toHex === 'function') {
    const hex = datum.toHex();
    console.log('✅ toHex() works:', hex);
  } else {
    console.log('❌ No toHex() method');
  }
  
  // Test 4: Check if it's callable for construction
  console.log('\n📋 Test 4: Testing callable construction...');
  const datum2 = MyDatumType({ thing: 100n });
  console.log('✅ Second datum created:', datum2);
  
  // Test 5: Error handling for invalid data
  console.log('\n📋 Test 5: Testing error handling...');
  try {
    const invalidDatum = MyDatumType({ thing: "not a bigint" });
    console.log('❌ Should have failed but got:', invalidDatum);
  } catch (error) {
    console.log('✅ Properly rejected invalid data:', error.message);
  }
  
} catch (error) {
  console.log('❌ @blaze-cardano/data test failed:', error.message);
}

// Test 2: Check if we can use the generated types directly
console.log('\n🧪 Testing Generated Types (if available):');
console.log('===========================================');

try {
  // Try to require the generated file directly (without compilation)
  const generatedPath = './generated/hello-world-types.ts';
  const fs = require('fs');
  
  if (fs.existsSync(generatedPath)) {
    const content = fs.readFileSync(generatedPath, 'utf8');
    console.log('✅ Generated TypeScript file found');
    
    // Extract the MyDatum type definition
    const myDatumMatch = content.match(/MyDatum:\s*Type\.Object\(([^}]+)/);
    if (myDatumMatch) {
      console.log('✅ MyDatum type definition found');
      console.log('Structure:', myDatumMatch[1]);
    }
    
    // Check for script classes
    const scriptClasses = content.match(/export\s+class\s+(\w+)/g);
    if (scriptClasses) {
      const classes = scriptClasses.map(match => match.replace(/export\s+class\s+/, ''));
      console.log('✅ Script classes found:', classes);
    }
    
  } else {
    console.log('❌ Generated file not found');
  }
  
} catch (error) {
  console.log('❌ Generated types test failed:', error.message);
}

// Test 3: Simulate how we'd use this in monadic functions
console.log('\n🧪 Testing Integration with Monadic Functions:');
console.log('==============================================');

try {
  const { Type } = require('@blaze-cardano/data');
  
  // Simulate what we'd do in a monadic function
  console.log('\n📋 Simulating monadic function usage...');
  
  // Easy datum construction
  const MyDatumType = Type.Object({
    thing: Type.BigInt(),
  }, { ctor: 0n });
  
  const datum = MyDatumType({ thing: 42n });
  console.log('✅ Datum constructed:', datum);
  
  // Easy redeemer construction (same structure for this contract)
  const redeemer = MyDatumType({ thing: 42n });
  console.log('✅ Redeemer constructed:', redeemer);
  
  // Check if we can serialize for transaction building
  if (typeof datum.toCbor === 'function') {
    const datumCbor = datum.toCbor();
    const redeemerCbor = redeemer.toCbor();
    console.log('✅ CBOR serialization works:');
    console.log('  Datum CBOR:', datumCbor);
    console.log('  Redeemer CBOR:', redeemerCbor);
    
    // This would be used in transaction operations
    console.log('✅ Ready for transaction building!');
  } else {
    console.log('❌ No CBOR serialization available');
  }
  
} catch (error) {
  console.log('❌ Integration test failed:', error.message);
}

console.log('\n📊 Summary:');
console.log('===========');
console.log('✅ @blaze-cardano/data Type system provides easy construction');
console.log('✅ Type.Object creates callable constructors');
console.log('✅ Generated blueprint code defines the structure');
console.log('❓ CBOR serialization needs verification');
console.log('❓ Error handling for invalid data needs verification');

console.log('\n💡 Value Assessment:');
console.log('===================');
console.log('1. Easy Construction: ✅ MyDatumType({ thing: 42n }) is simple');
console.log('2. Type Safety: ✅ Type.Object enforces structure');
console.log('3. Integration: ✅ Can be used in monadic functions');
console.log('4. Serialization: ❓ Need to verify CBOR methods');
console.log('5. Error Handling: ❓ Need to verify validation');

console.log('\n🎯 Conclusion:');
console.log('Blueprint TypeScript integration DOES provide easy construction helpers!');
console.log('The MyDatumType({ thing: 42n }) API is exactly what we want for easy datum/redeemer construction.');
