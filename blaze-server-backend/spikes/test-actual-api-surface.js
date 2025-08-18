#!/usr/bin/env node

/**
 * Test the actual @blaze-cardano/data API surface to understand how to use it
 */

console.log('🔍 Testing @blaze-cardano/data API Surface\n');

try {
  const { Type } = require('@blaze-cardano/data');
  console.log('✅ Type imported from @blaze-cardano/data');
  
  console.log('\n📋 Type properties:', Object.getOwnPropertyNames(Type));
  
  // Test Type.Object
  console.log('\n🧪 Testing Type.Object:');
  console.log('======================');
  
  const MyDatumType = Type.Object({
    thing: Type.BigInt(),
  }, { ctor: 0n });
  
  console.log('MyDatumType:', MyDatumType);
  console.log('MyDatumType type:', typeof MyDatumType);
  console.log('MyDatumType properties:', Object.getOwnPropertyNames(MyDatumType));
  
  // Check if it's callable
  if (typeof MyDatumType === 'function') {
    console.log('✅ MyDatumType is callable');
    try {
      const datum = MyDatumType({ thing: 42n });
      console.log('✅ Datum created:', datum);
    } catch (error) {
      console.log('❌ Call failed:', error.message);
    }
  } else {
    console.log('❌ MyDatumType is not callable');
    
    // Check if it has a create method
    if (typeof MyDatumType.create === 'function') {
      console.log('✅ MyDatumType.create is available');
      try {
        const datum = MyDatumType.create({ thing: 42n });
        console.log('✅ Datum created with .create():', datum);
      } catch (error) {
        console.log('❌ .create() failed:', error.message);
      }
    }
    
    // Check if it has a fromData method
    if (typeof MyDatumType.fromData === 'function') {
      console.log('✅ MyDatumType.fromData is available');
      try {
        const datum = MyDatumType.fromData({ thing: 42n });
        console.log('✅ Datum created with .fromData():', datum);
      } catch (error) {
        console.log('❌ .fromData() failed:', error.message);
      }
    }
    
    // Check if it has a constructor
    if (typeof MyDatumType.constructor === 'function') {
      console.log('✅ MyDatumType has constructor');
      try {
        const datum = new MyDatumType({ thing: 42n });
        console.log('✅ Datum created with new:', datum);
      } catch (error) {
        console.log('❌ new constructor failed:', error.message);
      }
    }
  }
  
  // Test Type.Module
  console.log('\n🧪 Testing Type.Module:');
  console.log('=======================');
  
  const Contracts = Type.Module({
    MyDatum: Type.Object({
      thing: Type.BigInt(),
    }, { ctor: 0n }),
  });
  
  console.log('Contracts:', Contracts);
  console.log('Contracts type:', typeof Contracts);
  console.log('Contracts properties:', Object.getOwnPropertyNames(Contracts));
  
  // Check if it has an Import method
  if (typeof Contracts.Import === 'function') {
    console.log('✅ Contracts.Import is available');
    try {
      const MyDatum = Contracts.Import("MyDatum");
      console.log('✅ MyDatum imported:', MyDatum);
      console.log('MyDatum type:', typeof MyDatum);
      console.log('MyDatum properties:', Object.getOwnPropertyNames(MyDatum));
      
      // Test if the imported type is callable
      if (typeof MyDatum === 'function') {
        console.log('✅ Imported MyDatum is callable');
        try {
          const datum = MyDatum({ thing: 42n });
          console.log('✅ Datum created from imported type:', datum);
        } catch (error) {
          console.log('❌ Imported type call failed:', error.message);
        }
      } else {
        console.log('❌ Imported MyDatum is not callable');
      }
      
    } catch (error) {
      console.log('❌ Import failed:', error.message);
    }
  }
  
  // Test other Type methods
  console.log('\n🧪 Testing Other Type Methods:');
  console.log('==============================');
  
  const bigIntType = Type.BigInt();
  console.log('BigInt type:', bigIntType);
  console.log('BigInt type properties:', Object.getOwnPropertyNames(bigIntType));
  
  // Check if BigInt type is callable
  if (typeof bigIntType === 'function') {
    console.log('✅ BigInt type is callable');
    try {
      const value = bigIntType(42n);
      console.log('✅ BigInt value created:', value);
    } catch (error) {
      console.log('❌ BigInt creation failed:', error.message);
    }
  }
  
} catch (error) {
  console.log('❌ Test failed:', error.message);
  console.log('Stack:', error.stack);
}

console.log('\n📊 API Surface Summary:');
console.log('=======================');
console.log('✅ @blaze-cardano/data Type system is available');
console.log('❓ Need to understand the correct construction API');
console.log('❓ Type.Object creates objects, not callable functions');
console.log('❓ Type.Module may provide the construction helpers we need');
