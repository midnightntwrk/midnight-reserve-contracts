#!/usr/bin/env node

/**
 * Debug script to test blueprint import functionality
 */

async function testBlueprintImport() {
  console.log('🔍 Testing blueprint import...');
  
  try {
    // Test 1: Try to import the blueprint module
    console.log('\n📦 Test 1: Importing blueprint module...');
    const blueprintModule = await import('./dist/utils/contracts.js');
    console.log('✅ Import successful!');
    console.log('📋 Available exports:', Object.keys(blueprintModule));
    
    // Test 2: Check what's in the module
    console.log('\n🔍 Test 2: Examining module contents...');
    Object.keys(blueprintModule).forEach(key => {
      const value = blueprintModule[key];
      console.log(`  ${key}:`, typeof value);
      if (typeof value === 'function') {
        console.log(`    - Is function: true`);
        console.log(`    - Has prototype:`, !!value.prototype);
        if (value.prototype) {
          console.log(`    - Has Script property:`, !!value.prototype.Script);
        }
      }
    });
    
    // Test 3: Try to find contract classes
    console.log('\n🔍 Test 3: Looking for contract classes...');
    const classNames = Object.keys(blueprintModule).filter(key => 
      typeof blueprintModule[key] === 'function' &&
      blueprintModule[key].prototype &&
      blueprintModule[key].prototype.constructor &&
      key.includes('HelloWorld') // For now, look for HelloWorld classes
    );
    
    console.log('📋 Contract classes found:', classNames);
    
    if (classNames.length > 0) {
      // Test 4: Try to instantiate a contract class
      console.log('\n🔍 Test 4: Testing contract class instantiation...');
      const className = classNames[0];
      const ContractClass = blueprintModule[className];
      console.log(`  Trying to instantiate: ${className}`);
      
      const instance = new ContractClass();
      console.log('✅ Instance created successfully!');
      console.log('  Script type:', typeof instance.Script);
      console.log('  Script toString:', instance.Script.toString().substring(0, 50) + '...');
    }
    
  } catch (error) {
    console.error('❌ Error during testing:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testBlueprintImport().then(() => {
  console.log('\n✅ Debug test completed!');
}).catch(error => {
  console.error('❌ Debug test failed:', error);
});
