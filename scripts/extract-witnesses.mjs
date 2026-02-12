#!/usr/bin/env node
import { readFileSync } from 'fs';
import { Buffer } from 'buffer';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node extract-witnesses.mjs <tx-file.json>');
  process.exit(1);
}

const txData = JSON.parse(readFileSync(file, 'utf-8'));
const cborHex = txData.cborHex;
const bytes = Buffer.from(cborHex, 'hex');

// Simple CBOR parser for extracting witness set
let pos = 0;

function readByte() {
  return bytes[pos++];
}

function readBytes(n) {
  const result = bytes.subarray(pos, pos + n);
  pos += n;
  return result;
}

function readLength(initialByte) {
  const additionalInfo = initialByte & 0x1f;
  if (additionalInfo < 24) return additionalInfo;
  if (additionalInfo === 24) return readByte();
  if (additionalInfo === 25) return (readByte() << 8) | readByte();
  if (additionalInfo === 26) {
    return (readByte() << 24) | (readByte() << 16) | (readByte() << 8) | readByte();
  }
  throw new Error('Unsupported length encoding');
}

function skipValue() {
  const byte = readByte();
  const majorType = byte >> 5;
  const additionalInfo = byte & 0x1f;

  switch (majorType) {
    case 0: // unsigned int
    case 1: // negative int
    case 7: // simple/float
      if (additionalInfo < 24) return;
      if (additionalInfo === 24) { readByte(); return; }
      if (additionalInfo === 25) { readBytes(2); return; }
      if (additionalInfo === 26) { readBytes(4); return; }
      if (additionalInfo === 27) { readBytes(8); return; }
      break;
    case 2: // byte string
    case 3: // text string
      const len = readLength(byte);
      readBytes(len);
      break;
    case 4: // array
      const arrLen = readLength(byte);
      for (let i = 0; i < arrLen; i++) skipValue();
      break;
    case 5: // map
      const mapLen = readLength(byte);
      for (let i = 0; i < mapLen; i++) {
        skipValue(); // key
        skipValue(); // value
      }
      break;
    case 6: // tag
      readLength(byte); // tag number
      skipValue(); // tagged value
      break;
  }
}

function readMap() {
  const byte = readByte();
  const majorType = byte >> 5;
  if (majorType !== 5) throw new Error(`Expected map, got major type ${majorType}`);
  return readLength(byte);
}

function readArray() {
  const byte = readByte();
  const majorType = byte >> 5;
  if (majorType !== 4) throw new Error(`Expected array, got major type ${majorType}`);
  return readLength(byte);
}

function readByteString() {
  const byte = readByte();
  const majorType = byte >> 5;
  if (majorType !== 2) throw new Error(`Expected byte string, got major type ${majorType}`);
  const len = readLength(byte);
  return readBytes(len);
}

function readUint() {
  const byte = readByte();
  const majorType = byte >> 5;
  if (majorType !== 0) throw new Error(`Expected uint, got major type ${majorType}`);
  return readLength(byte);
}

try {
  // Transaction is [tx_body, tx_witness_set, valid, auxiliary_data?]
  const txArrayLen = readArray();
  console.error(`Transaction array length: ${txArrayLen}`);

  // Skip tx_body (first element)
  skipValue();
  console.error('Skipped tx_body');

  // Read tx_witness_set (second element - it's a map)
  const witnessSetLen = readMap();
  console.error(`Witness set has ${witnessSetLen} entries`);

  let witnesses = [];

  for (let i = 0; i < witnessSetLen; i++) {
    const key = readUint();
    console.error(`Witness set key: ${key}`);

    if (key === 0) {
      // vkeywitnesses - might be tagged as a set (tag 258)
      let nextByte = bytes[pos];
      if ((nextByte >> 5) === 6) {
        // It's a tag, read and skip the tag number
        const tagByte = readByte();
        const tagNum = readLength(tagByte);
        console.error(`Found tag ${tagNum}`);
        // The tagged value follows
      }

      // Now read the array of [vkey, sig]
      const vkeywitLen = readArray();
      console.error(`Found ${vkeywitLen} vkey witnesses`);

      for (let j = 0; j < vkeywitLen; j++) {
        const pairLen = readArray();
        if (pairLen !== 2) throw new Error('Expected vkey witness to be a pair');

        const vkey = readByteString();
        const sig = readByteString();

        // Build cardano-cli witness CBOR: [0, [vkey, sig]]
        // 82 = array of 2 elements
        // 00 = uint 0 (witness type)
        // 82 = array of 2 elements
        // 5820 = byte string of 32 bytes (vkey)
        // 5840 = byte string of 64 bytes (sig)

        const witnessCbor = Buffer.concat([
          Buffer.from([0x82, 0x00, 0x82]),
          Buffer.from([0x58, 0x20]),
          vkey,
          Buffer.from([0x58, 0x40]),
          sig,
        ]);

        witnesses.push({
          vkey: vkey.toString('hex'),
          signature: sig.toString('hex'),
          cborHex: witnessCbor.toString('hex'),
        });
      }
    } else {
      // Skip other witness types
      skipValue();
    }
  }

  console.error(`\nExtracted ${witnesses.length} witnesses\n`);

  // Output as cardano-cli witness files
  witnesses.forEach((w, i) => {
    const witnessFile = {
      type: "TxWitness ConwayEra",
      description: "Key Witness",
      cborHex: w.cborHex,
    };
    console.log(`\n=== Witness ${i + 1} ===`);
    console.log(`VKey: ${w.vkey}`);
    console.log(`Signature: ${w.signature}`);
    console.log('\nCardano-CLI Witness File:');
    console.log(JSON.stringify(witnessFile, null, 2));
  });

} catch (error) {
  console.error('Error parsing CBOR:', error.message);
  console.error('Position:', pos);
  process.exit(1);
}
