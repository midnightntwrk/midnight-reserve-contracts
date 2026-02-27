import { writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "fs";
import { signTransaction } from "./cli-yargs/lib/transaction.js";
import { parsePrivateKeys } from "./cli-yargs/lib/signers.js";

const txHash = process.argv[2]!;
const witnessDir = "./witnesses";

if (!existsSync(witnessDir)) mkdirSync(witnessDir);
else {
  for (const f of readdirSync(witnessDir)) {
    if (f.startsWith("witness-") && f.endsWith(".json")) unlinkSync(`${witnessDir}/${f}`);
  }
}

const techKeys = parsePrivateKeys("TECH_AUTH_PRIVATE_KEYS");
const councilKeys = parsePrivateKeys("COUNCIL_PRIVATE_KEYS");

console.log(`Signing tx hash: ${txHash}`);
console.log(`Tech auth keys: ${techKeys.length}, Council keys: ${councilKeys.length}`);

const techSigs = signTransaction(txHash, techKeys);
const councilSigs = signTransaction(txHash, councilKeys);
const allSigs = [...techSigs, ...councilSigs];

let num = 1;
for (const [pubKey, sig] of allSigs) {
  const cborHex = `8200825820${pubKey}5840${sig}`;
  const envelope = { type: "TxWitness ConwayEra", description: `Signature ${num}`, cborHex };
  const filename = `${witnessDir}/witness-${num}.json`;
  writeFileSync(filename, JSON.stringify(envelope, null, 2));
  console.log(`Created: ${filename} (pubKey: ${(pubKey as string).slice(0, 16)}...)`);
  num++;
}
console.log(`\nCreated ${num - 1} witness files`);
