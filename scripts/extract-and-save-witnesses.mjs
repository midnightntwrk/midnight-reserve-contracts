#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { Buffer } from 'buffer';
import { dirname, basename } from 'path';

const file = process.argv[2];
const outputDir = process.argv[3] || '.';

if (!file) {
  console.error('Usage: node extract-and-save-witnesses.mjs <tx-file.json> [output-dir]');
  process.exit(1);
}

const txData = JSON.parse(readFileSync(file, 'utf-8'));
const cborHex = txData.cborHex;
const bytes = Buffer.from(cborHex, 'hex');

console.error(`Total CBOR length: ${bytes.length} bytes`);
console.error(`Looking for witness set in transaction...\n`);

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
  const startPos = pos;
  const byte = readByte();
  const majorType = byte >> 5;
  const additionalInfo = byte & 0x1f;

  switch (majorType) {
    case 0: // unsigned int
    case 1: // negative int
    case 7: // simple/float
      if (additionalInfo < 24) break;
      if (additionalInfo === 24) { readByte(); break; }
      if (additionalInfo === 25) { readBytes(2); break; }
      if (additionalInfo === 26) { readBytes(4); break; }
      if (additionalInfo === 27) { readBytes(8); break; }
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
  console.error(`  Skipped ${pos - startPos} bytes from position ${startPos}`);
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
  console.error(`\nSkipping tx_body at position ${pos}...`);
  skipValue();
  console.error(`After tx_body, position: ${pos}`);

  // Read tx_witness_set (second element - it's a map)
  console.error(`\nReading witness set at position ${pos}...`);
  const witnessSetLen = readMap();
  console.error(`Witness set has ${witnessSetLen} entries`);

  let witnesses = [];

  for (let i = 0; i < witnessSetLen; i++) {
    const keyPos = pos;
    const key = readUint();
    console.error(`\nWitness set key ${key} at position ${keyPos}`);

    if (key === 0) {
      // vkeywitnesses - might be tagged as a set (tag 258)
      const beforeTag = pos;
      let nextByte = bytes[pos];
      if ((nextByte >> 5) === 6) {
        // It's a tag, read and skip the tag number
        const tagByte = readByte();
        const tagNum = readLength(tagByte);
        console.error(`  Found tag ${tagNum} at position ${beforeTag}`);
      }

      // Now read the array of [vkey, sig]
      const arrayPos = pos;
      const vkeywitLen = readArray();
      console.error(`  Found array of ${vkeywitLen} vkey witnesses at position ${arrayPos}`);

      for (let j = 0; j < vkeywitLen; j++) {
        const witnessPos = pos;
        const pairLen = readArray();
        if (pairLen !== 2) throw new Error(`Expected vkey witness to be a pair, got ${pairLen}`);

        const vkey = readByteString();
        const sig = readByteString();

        console.error(`    Witness ${j + 1}: vkey at ${witnessPos}, ${vkey.length} bytes`);

        // Build cardano-cli witness CBOR: [0, [vkey, sig]]
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
      const beforeSkip = pos;
      skipValue();
      console.error(`  Skipped witness type ${key}, ${pos - beforeSkip} bytes`);
    }
  }

  console.error(`\n✓ Extracted ${witnesses.length} witnesses\n`);

  if (witnesses.length === 0) {
    console.error('ERROR: No witnesses found!');
    process.exit(1);
  }

  // Save each witness to a file
  const baseName = basename(file, '.json');
  witnesses.forEach((w, i) => {
    const witnessFile = {
      type: "TxWitness ConwayEra",
      description: "Key Witness",
      cborHex: w.cborHex,
    };

    const outputFile = `${outputDir}/${baseName}-witness-${i + 1}.json`;
    writeFileSync(outputFile, JSON.stringify(witnessFile, null, 2));
    console.log(`Saved witness ${i + 1} to ${outputFile}`);
    console.log(`  VKey: ${w.vkey}`);
    console.log(`  Signature: ${w.signature.substring(0, 32)}...`);
  });

} catch (error) {
  console.error('\nError parsing CBOR:', error.message);
  console.error('Position:', pos);
  console.error('Bytes at position:', bytes.subarray(Math.max(0, pos - 10), pos + 10).toString('hex'));
  process.exit(1);
}
