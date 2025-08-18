
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
