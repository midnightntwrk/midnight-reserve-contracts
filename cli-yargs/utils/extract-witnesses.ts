import {
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from "fs";
import { Transaction, TxCBOR, HexBlob } from "@blaze-cardano/core";

interface TextEnvelope {
  type: string;
  description: string;
  cborHex: string;
}

interface SignedTx {
  cborHex: string;
  signed: boolean;
}

const txFile = process.argv[2]!;

const txContent = readFileSync(txFile, "utf-8");
const txJson: SignedTx = JSON.parse(txContent);

if (!txJson.signed) {
  console.error("Transaction is not signed!");
  process.exit(1);
}

const tx = Transaction.fromCbor(TxCBOR(HexBlob(txJson.cborHex)));
const witnessSet = tx.witnessSet();
const vkeys = witnessSet.vkeys();

if (!vkeys || vkeys.values().length === 0) {
  console.error("No witnesses found in transaction!");
  process.exit(1);
}

console.log(`Found ${vkeys.values().length} witness(es) in ${txFile}`);

const witnessDir = "./witnesses";
if (!existsSync(witnessDir)) {
  mkdirSync(witnessDir);
} else {
  const existingFiles = readdirSync(witnessDir);
  for (const file of existingFiles) {
    if (file.startsWith("witness-") && file.endsWith(".json")) {
      unlinkSync(`${witnessDir}/${file}`);
      console.log(`Deleted existing file: ${file}`);
    }
  }
}

let witnessNum = 1;
for (const vkey of vkeys.values()) {
  const pubKey = vkey.vkey();
  const signature = vkey.signature();

  if (pubKey.length !== 64) {
    throw new Error(
      `Invalid pubKey length: expected 64 hex chars, got ${pubKey.length}`,
    );
  }
  if (signature.length !== 128) {
    throw new Error(
      `Invalid signature length: expected 128 hex chars, got ${signature.length}`,
    );
  }

  // CBOR: [0, [vkey, sig]]
  // 82 00 82 5820<vkey> 5840<sig>
  const cborHex = `8200825820${pubKey}5840${signature}`;

  const witnessEnvelope: TextEnvelope = {
    type: "TxWitness ConwayEra",
    description: `Signature ${witnessNum}`,
    cborHex: cborHex,
  };

  const filename = `${witnessDir}/witness-${witnessNum}.json`;
  writeFileSync(filename, JSON.stringify(witnessEnvelope, null, 2));
  console.log(`Created: ${filename}`);

  witnessNum++;
}

console.log(`\nExtracted ${witnessNum - 1} witness(es) to ${witnessDir}/`);
