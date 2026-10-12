import { describe, test, expect } from "bun:test";
import {
  Redeemer,
  RedeemerPurpose,
  Redeemers,
  RedeemerTag,
  Transaction,
  TransactionBody,
  TransactionWitnessSet,
  PlutusData,
  ExUnits,
  CborSet,
  Address,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  Value,
} from "@blaze-cardano/core";
import { Kupmios } from "@blaze-cardano/query";

// Two Kupmios bugs patched in patches/@blaze-cardano%2Fquery@0.6.2.patch, both hit by
// local-env deploys once script stake registrations carry a cert redeemer. Drop the
// patch once butaneprotocol/blaze-cardano#367 ships.
function certTx(): Transaction {
  const redeemer = new Redeemer(
    RedeemerTag.Cert,
    0n,
    PlutusData.newInteger(0n),
    ExUnits.fromCore({ memory: 0, steps: 0 }),
  );
  const witnessSet = new TransactionWitnessSet();
  witnessSet.setRedeemers(Redeemers.fromCore([redeemer.toCore()]));
  const body = new TransactionBody(
    CborSet.fromCore([], () => null as never),
    [],
    0n,
  );
  return new Transaction(body, witnessSet);
}

function utxo(): TransactionUnspentOutput {
  return new TransactionUnspentOutput(
    new TransactionInput(TransactionId("aa".repeat(32)), 16n),
    new TransactionOutput(
      Address.fromBech32(
        "addr_test1vr5vxqpnpl3325cu4zw55tnapjqzzx78pdrnk8k5j7wl72c6y08nd",
      ),
      new Value(5_000_000n),
    ),
  );
}

describe("Kupmios evaluateTransaction", () => {
  test("matches an ogmios 'publish' result to the cert redeemer", async () => {
    const tx = certTx();

    const ogmios = {
      url: "ws://unused",
      evaluateTransaction: async () => [
        {
          validator: { index: 0, purpose: "publish" },
          budget: { memory: 7, cpu: 11 },
        },
      ],
    };
    const kupmios = new Kupmios("http://unused", ogmios as never);
    (
      kupmios as never as { resolveUnspentOutputs: () => Promise<[]> }
    ).resolveUnspentOutputs = async () => [];

    const result = await kupmios.evaluateTransaction(tx, []);
    const [cert] = result.toCore();
    expect(cert.purpose).toBe(RedeemerPurpose.certificate);
    expect(cert.executionUnits).toEqual({ memory: 7, steps: 11 });
  });

  // Ogmios rejects additional UTxOs that are already on chain (error 3002); Kupmios
  // meant to drop them, but compared resolved UTxOs by object identity.
  test("drops additional UTxOs that are already on chain", async () => {
    let sentAdditional: unknown[] | undefined;
    const ogmios = {
      url: "ws://unused",
      evaluateTransaction: async (_tx: unknown, additional: unknown[]) => {
        sentAdditional = additional;
        return [
          {
            validator: { index: 0, purpose: "publish" },
            budget: { memory: 7, cpu: 11 },
          },
        ];
      },
    };
    const kupmios = new Kupmios("http://unused", ogmios as never);
    // the ledger knows this UTxO; the provider returns an equal but distinct object
    (
      kupmios as never as {
        resolveUnspentOutputs: () => Promise<TransactionUnspentOutput[]>;
      }
    ).resolveUnspentOutputs = async () => [utxo()];

    await kupmios.evaluateTransaction(certTx(), [utxo()]);
    expect(sentAdditional).toEqual([]);
  });
});
