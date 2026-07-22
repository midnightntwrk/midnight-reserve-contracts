#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// List of deployment-transactions.json files to convert
const files = [
  'deployments/preview/deployment-transactions.json',
  'deployments/preprod/deployment-transactions.json',
  'deployments/qanet/deployment-transactions.json',
  'deployments/devnet/deployment-transactions.json',
];

for (const file of files) {
  const fullPath = resolve(process.cwd(), file);
  console.log(`Converting ${file}...`);

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(content);

    // Check if it needs conversion
    if (data.transactions && Array.isArray(data.transactions)) {
      const firstTx = data.transactions[0];
      if (firstTx && 'cbor' in firstTx && !('cborHex' in firstTx)) {
        // Needs conversion
        console.log(`  Converting ${data.transactions.length} transactions...`);

        data.transactions = data.transactions.map((tx) => {
          // Handle both formats: cbor as string or array
          const cborValue = Array.isArray(tx.cbor) ? tx.cbor[0] : tx.cbor;

          return {
            type: 'Tx ConwayEra',
            description: tx.name,
            cborHex: cborValue,
            txHash: tx.hash,
            signed: false,
          };
        });

        writeFileSync(fullPath, JSON.stringify(data, null, 2));
        console.log(`  Converted successfully`);
      } else {
        console.log(`  Already in new format`);
      }
    } else {
      console.log(`  No transactions array found`);
    }
  } catch (error) {
    console.error(`  Error: ${error.message}`);
  }
}

console.log('\nDone!');
