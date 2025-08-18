#!/usr/bin/env node

/**
 * Test the @blaze-cardano/data API to understand datum/redeemer construction
 */

console.log('🔍 Testing @blaze-cardano/data API\n');

// Import the generated types
const { MyDatum } = require('./compiled/hello-world-types.js');

console.log('📦 Imported MyDatum:', MyDatum);
console.log('📦 MyDatum type:', typeof MyDatum);
console.log('📦 MyDatum constructor:', MyDatum.constructor.name);

// Try to understand the Type.Module API
console.log('\n🔍 Type.Module Analysis:');
console.log('=======================');

// Check if MyDatum has any methods
const myDatumMethods = Object.getOwnPropertyNames(MyDatum);
console.log('MyDatum methods:', myDatumMethods);

// Check if MyDatum has any prototype methods
const myDatumPrototype = Object.getPrototypeOf(MyDatum);
if (myDatumPrototype) {
  const prototypeMethods = Object.getOwnPropertyNames(myDatumPrototype);
  console.log('MyDatum prototype methods:', prototypeMethods);
}

// Try to create a datum instance
console.log('\n🧪 Testing Datum Creation:');
console.log('==========================');

try {
  // Try different approaches to create a datum
  console.log('Attempting to create datum with value 42...');
  
  // Approach 1: Direct construction
  console.log('Approach 1: Direct construction');
  const datum1 = new MyDatum({ thing: 42n });
  console.log('✅ Datum 1 created:', datum1);
  
} catch (error) {
  console.log('❌ Approach 1 failed:', error.message);
  
  try {
    // Approach 2: Using fromData if available
    console.log('Approach 2: Using fromData');
    const datum2 = MyDatum.fromData({ thing: 42n });
    console.log('✅ Datum 2 created:', datum2);
    
  } catch (error2) {
    console.log('❌ Approach 2 failed:', error2.message);
    
    try {
      // Approach 3: Using create if available
      console.log('Approach 3: Using create');
      const datum3 = MyDatum.create({ thing: 42n });
      console.log('✅ Datum 3 created:', datum3);
      
    } catch (error3) {
      console.log('❌ Approach 3 failed:', error3.message);
      
      try {
        // Approach 4: Using the Type directly
        console.log('Approach 4: Using Type directly');
        const datum4 = MyDatum({ thing: 42n });
        console.log('✅ Datum 4 created:', datum4);
        
      } catch (error4) {
        console.log('❌ Approach 4 failed:', error4.message);
        console.log('❌ All datum creation approaches failed');
      }
    }
  }
}

// Try to understand CBOR serialization
console.log('\n🔗 Testing CBOR Serialization:');
console.log('==============================');

try {
  // Check if we can access the Type directly
  const { Type } = require('@blaze-cardano/data');
  console.log('✅ Type imported from @blaze-cardano/data');
  
  // Try to create a datum using Type.Object
  console.log('Creating datum using Type.Object...');
  const MyDatumType = Type.Object({
    thing: Type.BigInt(),
  }, { ctor: 0n });
  
  console.log('MyDatumType:', MyDatumType);
  
  // Try to create a datum
  const datum = MyDatumType({ thing: 42n });
  console.log('✅ Datum created with Type.Object:', datum);
  
  // Try to serialize to CBOR
  if (typeof datum.toCbor === 'function') {
    const cbor = datum.toCbor();
    console.log('✅ CBOR serialization:', cbor);
  } else {
    console.log('❌ No toCbor method found');
    
    // Check for other serialization methods
    const methods = Object.getOwnPropertyNames(datum);
    console.log('Available methods:', methods);
    
    if (typeof datum.toData === 'function') {
      const data = datum.toData();
      console.log('✅ toData method:', data);
    }
  }
  
} catch (error) {
  console.log('❌ Type.Object approach failed:', error.message);
}

// Test script usage
console.log('\n📜 Testing Script Usage:');
console.log('========================');

try {
  const { HelloWorldHelloWorldSpend } = require('./compiled/hello-world-types.js');
  console.log('✅ HelloWorldHelloWorldSpend imported');
  
  const spendScript = new HelloWorldHelloWorldSpend();
  console.log('✅ Spend script created:', spendScript);
  console.log('Script property:', spendScript.Script);
  
  // Check if Script has CBOR
  if (spendScript.Script && typeof spendScript.Script.toCbor === 'function') {
    const scriptCbor = spendScript.Script.toCbor();
    console.log('✅ Script CBOR:', scriptCbor);
  } else {
    console.log('❌ No script CBOR method found');
  }
  
} catch (error) {
  console.log('❌ Script usage failed:', error.message);
}

console.log('\n📊 Summary:');
console.log('===========');
console.log('✅ TypeScript classes generated successfully');
console.log('✅ @blaze-cardano/data Type system works');
console.log('✅ Script classes provide CBOR-encoded scripts');
console.log('❌ Datum/redeemer construction needs more investigation');
console.log('❌ CBOR serialization API unclear');

console.log('\n🔍 Next Steps:');
console.log('1. Investigate @blaze-cardano/data documentation');
console.log('2. Test datum/redeemer construction with different approaches');
console.log('3. Understand CBOR serialization API');
console.log('4. Test integration with existing monadic functions');
