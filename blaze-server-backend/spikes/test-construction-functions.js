#!/usr/bin/env node

/**
 * Test for construction and validation functions in @blaze-cardano/data
 */

console.log('🔍 Testing @blaze-cardano/data Construction Functions\n');

try {
  const { Type, Value } = require('@blaze-cardano/data');
  console.log('✅ Type and Value imported from @blaze-cardano/data');
  
  console.log('\n📋 Available exports:', Object.keys(require('@blaze-cardano/data')));
  
  // Test Value module if it exists
  if (Value) {
    console.log('\n🧪 Testing Value module:');
    console.log('=======================');
    console.log('Value properties:', Object.getOwnPropertyNames(Value));
    
    // Try to create a datum using Value
    const MyDatumType = Type.Object({
      thing: Type.BigInt(),
    }, { ctor: 0n });
    
    try {
      const datum = Value.Create(MyDatumType, { thing: 42n });
      console.log('✅ Value.Create works:', datum);
    } catch (error) {
      console.log('❌ Value.Create failed:', error.message);
    }
  }
  
  // Test if there are other construction functions
  console.log('\n🧪 Testing other construction approaches:');
  console.log('==========================================');
  
  const MyDatumType = Type.Object({
    thing: Type.BigInt(),
  }, { ctor: 0n });
  
  // Try to find construction functions
  const allExports = require('@blaze-cardano/data');
  const constructionFunctions = Object.keys(allExports).filter(key => 
    key.toLowerCase().includes('create') || 
    key.toLowerCase().includes('from') || 
    key.toLowerCase().includes('build') ||
    key.toLowerCase().includes('make')
  );
  
  console.log('Potential construction functions:', constructionFunctions);
  
  // Test each potential function
  for (const funcName of constructionFunctions) {
    const func = allExports[funcName];
    if (typeof func === 'function') {
      console.log(`\n📋 Testing ${funcName}:`);
      try {
        const result = func(MyDatumType, { thing: 42n });
        console.log(`✅ ${funcName} works:`, result);
      } catch (error) {
        console.log(`❌ ${funcName} failed:`, error.message);
      }
    }
  }
  
  // Test if Type.Object has any methods for construction
  console.log('\n🧪 Testing Type.Object methods:');
  console.log('===============================');
  
  const methods = Object.getOwnPropertyNames(MyDatumType);
  console.log('MyDatumType methods:', methods);
  
  for (const method of methods) {
    if (typeof MyDatumType[method] === 'function') {
      console.log(`\n📋 Testing MyDatumType.${method}:`);
      try {
        const result = MyDatumType[method]({ thing: 42n });
        console.log(`✅ MyDatumType.${method} works:`, result);
      } catch (error) {
        console.log(`❌ MyDatumType.${method} failed:`, error.message);
      }
    }
  }
  
  // Test if we can use the type for validation
  console.log('\n🧪 Testing type validation:');
  console.log('===========================');
  
  try {
    // Try to use the type as a validator
    const isValid = Type.Check(MyDatumType, { thing: 42n });
    console.log('✅ Type.Check works:', isValid);
  } catch (error) {
    console.log('❌ Type.Check failed:', error.message);
  }
  
  // Test if we can create a datum manually
  console.log('\n🧪 Testing manual datum creation:');
  console.log('==================================');
  
  try {
    // Create a datum manually based on the type structure
    const manualDatum = {
      thing: 42n,
      // Add constructor tag if needed
      ctor: 0n
    };
    console.log('✅ Manual datum created:', manualDatum);
    
    // Check if it validates
    const isValid = Type.Check(MyDatumType, manualDatum);
    console.log('✅ Manual datum validates:', isValid);
    
  } catch (error) {
    console.log('❌ Manual datum creation failed:', error.message);
  }
  
} catch (error) {
  console.log('❌ Test failed:', error.message);
  console.log('Stack:', error.stack);
}

console.log('\n📊 Construction Functions Summary:');
console.log('===================================');
console.log('✅ @blaze-cardano/data provides type definitions');
console.log('❓ Need to find the actual construction functions');
console.log('❓ May need to use manual construction + validation');
console.log('❓ Or may need to use different @blaze-cardano packages');

console.log('\n💡 Key Finding:');
console.log('The Type system provides structure, but we need to find the construction helpers.');
console.log('This suggests the blueprint integration may NOT provide the easy construction we want.');
