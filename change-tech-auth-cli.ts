#!/usr/bin/env bun
import {
  Address,
  addressFromCredential,
  AssetId,
  AssetName,
  CborSet,
  Credential,
  CredentialType,
  Ed25519PrivateNormalKeyHex,
  Ed25519PublicKeyHex,
  derivePublicKey,
  Hash28ByteBase16,
  HexBlob,
  NativeScript,
  NativeScripts,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  RewardAccount,
  Script,
  signMessage,
  Transaction,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
  TxCBOR,
  VkeyWitness,
  Ed25519SignatureHex,
} from "@blaze-cardano/core";
import { Blaze, ColdWallet } from "@blaze-cardano/sdk";
import { serialize, parse } from "@blaze-cardano/data";
import { Maestro } from "@blaze-cardano/query";
import * as Contracts from "./contract_blueprint";
import { writeFileSync } from "fs";

function parseSigners(
  envVar: string,
): Array<{ paymentHash: string; sr25519Key: string }> {
  const signersEnv = process.env[envVar];
  if (!signersEnv) throw new Error(`${envVar} not found`);

  return signersEnv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((pair) => {
      const [paymentHash, sr25519Key] = pair.split(":").map((s) => s.trim());
      if (!paymentHash || !sr25519Key)
        throw new Error(`Invalid signer: ${pair}`);
      return { paymentHash, sr25519Key };
    });
}

function createMultisigState(
  signers: Array<{ paymentHash: string; sr25519Key: string }>,
): Contracts.Multisig {
  const signerMap: Record<string, string> = {};
  for (const signer of signers) {
    signerMap[`8200581c${signer.paymentHash}`] = signer.sr25519Key;
  }
  return [BigInt(signers.length), signerMap];
}

function createRedeemerMap(
  signers: Array<{ paymentHash: string; sr25519Key: string }>,
): Contracts.PermissionedRedeemer {
  const redeemerMap: Record<string, string> = {};
  for (const signer of signers) {
    redeemerMap[signer.paymentHash] = signer.sr25519Key;
  }
  return redeemerMap;
}

function parsePrivateKeys(envVar: string): string[] {
  const keysEnv = process.env[envVar];
  if (!keysEnv) throw new Error(`${envVar} not found`);

  return keysEnv
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error(
      "Usage: bun run change-tech-auth-cli.ts <network> <tx_hash> <tx_index>",
    );
    console.error(
      "Example: bun run change-tech-auth-cli.ts preview b451d1433cd54772f42dff46fecc76ba6d1c89202ffe10309fda5bb3313fbd48 11",
    );
    process.exit(1);
  }

  const [network, txHash, txIndex] = args;
  const outputIndex = parseInt(txIndex, 10);

  if (network !== "preview" && network !== "preprod" && network !== "mainnet") {
    console.error("Invalid network. Must be preview, preprod, or mainnet");
    process.exit(1);
  }

  if (!txHash || txHash.length !== 64 || isNaN(outputIndex)) {
    console.error("Invalid transaction hash or index");
    process.exit(1);
  }

  const apiKeyVar = `MAESTRO_${network.toUpperCase()}_API_KEY`;
  const urlVar = `MAESTRO_${network.toUpperCase()}_URL`;
  const apiKey = process.env[apiKeyVar];
  const apiUrl = process.env[urlVar];
  const deployerAddress = process.env.DEPLOYER_ADDRESS;

  if (!apiKey || !apiUrl || !deployerAddress) {
    console.error(
      `Missing ${apiKeyVar}, ${urlVar}, or DEPLOYER_ADDRESS in .env`,
    );
    process.exit(1);
  }

  console.log(`Using Maestro provider: ${apiUrl}`);

  const provider = new Maestro({
    network: network as any,
    apiKey: apiKey,
  });

  const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
  const techAuthLogic = new Contracts.PermissionedTechAuthLogicElse();
  const mainTechAuthUpdateThreshold =
    new Contracts.ThresholdsMainTechAuthUpdateThresholdElse();
  const councilForever = new Contracts.PermissionedCouncilForeverElse();
  const techAuthTwoStage =
    new Contracts.PermissionedTechAuthTwoStageUpgradeElse();

  const techAuthForeverAddress = addressFromCredential(
    NetworkId.Testnet,
    Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: techAuthForever.Script.hash(),
    }),
  );

  console.log(
    "\nTech Auth Forever Address:",
    techAuthForeverAddress.toBech32(),
  );

  const techAuthUpdateThresholdAddress = addressFromCredential(
    NetworkId.Testnet,
    Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: mainTechAuthUpdateThreshold.Script.hash(),
    }),
  );

  const councilForeverAddress = addressFromCredential(
    NetworkId.Testnet,
    Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: councilForever.Script.hash(),
    }),
  );

  const techAuthTwoStageAddress = addressFromCredential(
    NetworkId.Testnet,
    Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: techAuthTwoStage.Script.hash(),
    }),
  );

  // Fetch contract UTxOs
  const techAuthForeverUtxos = await provider.getUnspentOutputs(
    techAuthForeverAddress,
  );
  const techAuthThresholdUtxos = await provider.getUnspentOutputs(
    techAuthUpdateThresholdAddress,
  );
  const councilForeverUtxos = await provider.getUnspentOutputs(
    councilForeverAddress,
  );
  const techAuthTwoStageUtxos = await provider.getUnspentOutputs(
    techAuthTwoStageAddress,
  );

  console.log("\nFound contract UTxOs:");
  console.log("  Tech auth forever:", techAuthForeverUtxos.length);
  console.log("  Tech auth threshold:", techAuthThresholdUtxos.length);
  console.log("  Council forever:", councilForeverUtxos.length);
  console.log("  Tech auth two stage:", techAuthTwoStageUtxos.length);

  if (
    !techAuthForeverUtxos.length ||
    !techAuthThresholdUtxos.length ||
    !councilForeverUtxos.length ||
    !techAuthTwoStageUtxos.length
  ) {
    console.error("Missing required contract UTxOs");
    process.exit(1);
  }

  const techAuthForeverUtxo = techAuthForeverUtxos[0];
  const techAuthThresholdUtxo = techAuthThresholdUtxos[0];
  const councilForeverUtxo = councilForeverUtxos[0];

  // Filter for the "main" tech auth two-stage UTxO (not "staging")
  const mainAssetName = Buffer.from("main").toString("hex");
  const techAuthTwoStageUtxo = techAuthTwoStageUtxos.find((utxo) => {
    const assets = utxo.output().amount().multiasset();
    if (!assets) return false;

    for (const [assetId] of assets) {
      if (assetId.endsWith(mainAssetName)) {
        return true;
      }
    }
    return false;
  });

  if (!techAuthTwoStageUtxo) {
    console.error('Could not find tech auth two-stage UTxO with "main" asset');
    process.exit(1);
  }

  console.log("\nCurrent tech auth forever datum:");
  const currentDatum = techAuthForeverUtxo.output().datum();
  if (!currentDatum?.asInlineData()) {
    console.log("  Missing inline datum!");
    process.exit(1);
  }

  console.log("  Has inline datum");
  const currentTechAuthState = parse(
    Contracts.Multisig,
    currentDatum.asInlineData()!,
  );
  const [currentThreshold, currentTechAuthMap] = currentTechAuthState;
  console.log("  Current threshold:", currentThreshold);

  const currentTechAuthSigners = Object.entries(currentTechAuthMap).map(
    ([credHex, sr25519Key]) => {
      const paymentHash = credHex.slice(8);
      return { paymentHash, sr25519Key };
    },
  );

  if (!currentTechAuthSigners.length) {
    console.error("No tech auth signers found in tech auth forever datum");
    process.exit(1);
  }

  const newTechAuthSigners = parseSigners("TECH_AUTH_SIGNERS");
  const newTechAuthForeverState = createMultisigState(newTechAuthSigners);
  const memberRedeemer = createRedeemerMap(newTechAuthSigners);

  // Use exact threshold from test: 2-of-3 multisig
  const requiredSigners = 2;
  const councilRequiredSigners = 2;

  // For ML-3 validation, we need council native script from CURRENT on-chain state
  console.log("\nReading current council state for ML-3 validation...");
  const councilDatum = councilForeverUtxo.output().datum();
  if (!councilDatum?.asInlineData()) {
    console.error("Council forever UTxO missing inline datum");
    process.exit(1);
  }

  const currentCouncilState = parse(
    Contracts.Multisig,
    councilDatum.asInlineData()!,
  );
  const [_threshold, currentCouncilMap] = currentCouncilState;

  const currentCouncilSigners = Object.entries(currentCouncilMap).map(
    ([credHex, sr25519Key]) => {
      const paymentHash = credHex.slice(8);
      return { paymentHash, sr25519Key };
    },
  );

  if (!currentCouncilSigners.length) {
    console.error("No council signers found in council forever datum");
    process.exit(1);
  }

  const nativeScriptCouncil = NativeScripts.atLeastNOfK(
    councilRequiredSigners,
    ...currentCouncilSigners.map((s) => {
      const bech32 = addressFromCredential(
        NetworkId.Testnet,
        Credential.fromCore({
          type: CredentialType.KeyHash,
          hash: Hash28ByteBase16(s.paymentHash),
        }),
      ).toBech32();
      return NativeScripts.justAddress(bech32, NetworkId.Testnet);
    }),
  );

  const nativeScriptTechAuth = NativeScripts.atLeastNOfK(
    requiredSigners,
    ...currentTechAuthSigners.map((s) => {
      const bech32 = addressFromCredential(
        NetworkId.Testnet,
        Credential.fromCore({
          type: CredentialType.KeyHash,
          hash: Hash28ByteBase16(s.paymentHash),
        }),
      ).toBech32();
      return NativeScripts.justAddress(bech32, NetworkId.Testnet);
    }),
  );

  const councilPolicyId = PolicyId(nativeScriptCouncil.hash());
  const techAuthPolicyId = PolicyId(nativeScriptTechAuth.hash());

  const techAuthLogicRewardAccount = RewardAccount.fromCredential(
    Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: techAuthLogic.Script.hash(),
    }).toCore(),
    NetworkId.Testnet,
  );

  const networkId =
    network === "mainnet" ? NetworkId.Mainnet : NetworkId.Testnet;
  const changeAddress = Address.fromBech32(deployerAddress);
  const wallet = new ColdWallet(changeAddress, networkId, provider);
  const blaze = await Blaze.from(provider, wallet);

  // Fetch user UTXO for collateral
  console.log("\nFetching user UTXO...");
  const deployerUtxos = await provider.getUnspentOutputs(changeAddress);

  const userUtxo = deployerUtxos.find(
    (utxo) =>
      utxo.input().transactionId() === txHash &&
      utxo.input().index() === BigInt(outputIndex),
  );

  if (!userUtxo) {
    console.error(`User UTXO not found: ${txHash}#${outputIndex}`);
    process.exit(1);
  }

  console.log("\nBuilding transaction...");

  try {
    const txBuilder = blaze
      .newTransaction()
      .addInput(userUtxo)
      .addInput(techAuthForeverUtxo, PlutusData.newInteger(0n))
      .addReferenceInput(techAuthThresholdUtxo)
      .addReferenceInput(councilForeverUtxo)
      .addReferenceInput(techAuthTwoStageUtxo)
      .provideScript(techAuthForever.Script)
      .addMint(councilPolicyId, new Map([[AssetName(""), 1n]]))
      .provideScript(Script.newNativeScript(nativeScriptCouncil))
      .addMint(techAuthPolicyId, new Map([[AssetName(""), 1n]]))
      .provideScript(Script.newNativeScript(nativeScriptTechAuth))
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(techAuthForeverAddress.toBech32()),
          value: {
            coins: techAuthForeverUtxo.output().amount().coin(),
            assets: new Map([[AssetId(techAuthForever.Script.hash()), 1n]]),
          },
          datum: serialize(
            Contracts.Multisig,
            newTechAuthForeverState,
          ).toCore(),
        }),
      )
      .addWithdrawal(
        techAuthLogicRewardAccount,
        0n,
        serialize(Contracts.PermissionedRedeemer, memberRedeemer),
      )
      .provideScript(techAuthLogic.Script)
      .setChangeAddress(changeAddress)
      .setFeePadding(50000n);

    console.log("\n⏳ Completing transaction (with evaluation)...");
    const tx = await txBuilder.complete();

    console.log("\n✅ Transaction built:", tx.getId());

    // Parse tech auth private keys from .env
    const signerKeyGroups = [
      {
        label: "tech auth",
        keys: parsePrivateKeys("TECH_AUTH_PRIVATE_KEYS"),
      },
      {
        label: "council",
        keys: parsePrivateKeys("COUNCIL_PRIVATE_KEYS"),
      },
    ];

    // Create signatures using signMessage

    const signatureResults: [Ed25519PublicKeyHex, Ed25519SignatureHex][] = [];

    for (const { label, keys } of signerKeyGroups) {
      console.log(`\n🔑 Signing with ${keys.length} ${label} private keys...`);
      for (let i = 0; i < keys.length; i++) {
        const privateKeyHex = keys[i];
        console.log(`  Signing with ${label} key ${i + 1}...`);

        try {
          const privateKey = Ed25519PrivateNormalKeyHex(privateKeyHex);
          const publicKey = derivePublicKey(privateKey);
          const signature = signMessage(HexBlob(tx.getId()), privateKey);
          signatureResults.push([publicKey, signature]);
          console.log(`    ✓ Signature created`);
        } catch (err) {
          console.error(
            `    ✗ Failed to sign with ${label} key ${i + 1}:`,
            err,
          );
        }
      }
    }

    console.log(`\n📝 Created ${signatureResults.length} signatures`);

    const cborSet = CborSet.fromCore(
      signatureResults,
      function (i: ReturnType<VkeyWitness["toCore"]>) {
        return VkeyWitness.fromCore(i);
      },
    );

    const blazeTx = Transaction.fromCbor(TxCBOR(HexBlob(tx.toCbor())));
    const witnessSet = blazeTx.witnessSet();
    witnessSet.setVkeys(cborSet);
    blazeTx.setWitnessSet(witnessSet);

    console.log("\n✅ Witnesses attached to transaction");

    // Write signed transaction CBOR to file
    const signedTxCbor = blazeTx.toCbor();
    writeFileSync("cli-tx-signed.cbor", signedTxCbor, "utf-8");
    console.log("📝 Signed transaction CBOR written to cli-tx-signed.cbor");

    console.log("\nTransaction ID:", tx.getId());
  } catch (error) {
    console.error("\n❌ Transaction build failed:");
    console.error(error);
    if (error instanceof Error) {
      console.error("\nError message:", error.message);
    }
    throw error;
  }
}

main().catch(console.error);
