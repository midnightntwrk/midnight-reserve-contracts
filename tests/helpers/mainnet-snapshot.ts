import {
  AssetId,
  HexBlob,
  PlutusData,
  TransactionId,
  TransactionUnspentOutput,
  type Script,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import { readFileSync } from "fs";
import { Either, Record } from "effect";
import {
  cnightAssetId as cnightAssetIdOf,
  parseNetworkConfig,
} from "../../cli/config/settings";
import * as Contracts from "../../deployed-scripts/mainnet/contract_blueprint";
import { scriptAddress, zeroForeverDatum } from "./fixtures";

/** A mainnet UTxO as Blockfrost returned it, with the script it sits at. */
type SnapshotUtxo = {
  script: Script;
  tx_hash: string;
  tx_index: number;
  amount: { unit: string; quantity: string }[];
  inline_datum: string;
};

const contracts = {
  techAuthForever: new Contracts.PermissionedTechAuthForeverElse(),
  councilForever: new Contracts.PermissionedCouncilForeverElse(),
  mainGovThreshold: new Contracts.ThresholdsMainGovThresholdElse(),
  stagingGovThreshold: new Contracts.ThresholdsStagingGovThresholdElse(),
  techAuthTwoStage: new Contracts.PermissionedTechAuthTwoStageUpgradeElse(),
  councilTwoStage: new Contracts.PermissionedCouncilTwoStageUpgradeElse(),
  reserveTwoStage: new Contracts.ReserveReserveTwoStageUpgradeElse(),
  icsTwoStage: new Contracts.IlliquidCirculationSupplyIcsTwoStageUpgradeElse(),
};

export const cnightAssetId = cnightAssetIdOf(
  Either.getOrThrow(
    parseNetworkConfig("mainnet", readFileSync("aiken.toml", "utf-8")),
  ),
);

export const makeImaginaryForeverUtxo = (args: {
  script: Script;
  txHash: string;
  txIndex: number;
  coins: bigint;
  cnightAmount: bigint;
  randomAssetId: AssetId;
  randomAmount: bigint;
}) =>
  TransactionUnspentOutput.fromCore([
    { txId: TransactionId(args.txHash), index: args.txIndex },
    {
      address: scriptAddress(args.script),
      value: {
        coins: args.coins,
        assets: new Map([
          [cnightAssetId, args.cnightAmount],
          [args.randomAssetId, args.randomAmount],
        ]),
      },
      datum: zeroForeverDatum.toCore(),
    },
  ]);

const rawSnapshots = {
  techAuthForever: {
    script: contracts.techAuthForever.Script,
    tx_hash: "8dd59cc8ca3401bca9e4ab6b19d10ce31b0a9409acd890be2a359a3b272570a3",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "3710910" },
      {
        unit: "f9bfa20ed6136305b654b3613bbe1c9a6f2f058fb61edee49bdf58be",
        quantity: "1",
      },
    ],
    inline_datum:
      "9f9f09a958208200581c74322a8f479106c0ef7f2a2543602c129d644f0c991f94bddd2e2cf45820b689b5d2a3d95749c545b8741c190554b5ddcefff8292dcf27c87debf02cd90958208200581c725667557cd2e066195678fd93e56aaea71cbdb590844d5a8faaac525820f2621e50bdc83a697e82980c130cabf7fbab8cbfb1da62fd87db8a393efcf50958208200581c8718058872b602bba02310d5ef4a99916420827deac7771351d941fc5820587c434a0c77f3f79894db7cc6c51f47f2ec700261e05c7fcd451d4bedb23d2158208200581ca9ddb3fe145177feb35ceae9453cab288d2ec2cb0b280880c2ae9c4258204672d7a8e458fff87e5d2dd433c7a62c015a2f10e8d2a6c47ac0124bf927f57258208200581ccbea75ab4016844c7a2374fdc29fb9563800c0dc1320df5f7f70727f58200ee4490724f7d48ae03bdcb7e03b0c034274ef6956aeb2c15ea56f90b8555e0058208200581c622384b11119f491eed796af619ea4c5269b69e9daae64ca26e66bb458203a4d7108017b3481dd0943abf05727e326d4c631c2241c959f039c64c52bab0558208200581c689f5b50a768c8d0121fa320ab2ae93f3b61c51a4409f151d32e1d4f58201283566efb9d31000839f4d3a809914ba3b448856365dfffbb69ffddd381861f58208200581c2f8f659d73afdea16f4a55ceae7414efa9a551f28b27a5fd2f9a2d8b58207687acc51495d39dade0dfcf05c243295b5be4fe916a60e181eb5fe11c595f1158208200581c0b56a67604253752c52fb1fb0ab86849246e93226aefd43054dd3169582078df3b2f01949c61383498d28de9b8e517909f5c2a6e558e4a50569c9620a266ff00ff",
  },
  councilForever: {
    script: contracts.councilForever.Script,
    tx_hash: "4ed658573b4c74a43b18f0c90fd04f098497048267f230decef5ad55e5060765",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "2831670" },
      {
        unit: "911dee358e934f0ea32af5803586cbeee9721d20ab969f9fdff335ac",
        quantity: "1",
      },
    ],
    inline_datum:
      "9f9f06a658208200581c4ab24e49cec6bf57c3b672d621a19159dfbe05c1e8285a89b1105feb582002f07a50bcbcfa638171dd27f269c49d54e800ac87be4e2165d310129667bc5a58208200581cf5d31fd3054fe149a0761563a877c58ef755e8d24969e90c4dc13db85820c0e64f983bf729b000b9e8de94ecdc2d4a6b7155f43cf0c5d61672b40773040858208200581cb3b48a9d8140510133b0670e52f15fe414c91cbc87ee9609ba7330f6582024f2ac438bd054b7d931f6435b4e5145caadac82ec294226402715b2136e830658208200581cb1dc5c62c0cc8efd0683b583b7fbf720cb6f4fad0c5b335c2e82d6235820587c434a0c77f3f79894db7cc6c51f47f2ec700261e05c7fcd451d4bedb23d2158208200581c7465c949127a8e63526d3aa24a04b04644a834eda93c800e141bed6e58203a4d7108017b3481dd0943abf05727e326d4c631c2241c959f039c64c52bab0558208200581c1933851734e658dec58b51cce1a14a218979f2f7bb1c5bb06146b76e582064b1dc75b2bdbb29a85503020589861fb7f42659babced93cd8a46b30ec59f75ff00ff",
  },
  mainGovThreshold: {
    script: contracts.mainGovThreshold.Script,
    tx_hash: "8ae50d9066a4c404f0e89cc5c732ba41f6b07e693f7f0d1d48cac2c41954a1a2",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1060260" },
      {
        unit: "bd0d3863779d2e27dfc7bf8953ff49197900d8aef9e7ec4dca80e5e3",
        quantity: "1",
      },
    ],
    inline_datum: "9f02030203ff",
  },
  stagingGovThreshold: {
    script: contracts.stagingGovThreshold.Script,
    tx_hash: "68058a74ec5438b99880673e621cb50e515a139a01e1da15b2fe8d43076b3100",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1060260" },
      {
        unit: "08b27d7a74e2854c3024dfd9e2f9ad6318382ea80d85f904bb30df56",
        quantity: "1",
      },
    ],
    inline_datum: "9f01020001ff",
  },
  councilMain: {
    script: contracts.councilTwoStage.Script,
    tx_hash: "d707ea8f7381d395cc3c56c8950104069f4874c8b4044c5994e0b13ea7e48fef",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1340410" },
      {
        unit: "e91becb9536df62eed161713311cc534ae909636ba9529b38e2a18f36d61696e",
        quantity: "1",
      },
    ],
    inline_datum:
      "9f581c8909f41e675804f225f8aeb0615677317388b4311e5a6776b1ef971840581c00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c400000ff",
  },
  councilStaging: {
    script: contracts.councilTwoStage.Script,
    tx_hash: "d707ea8f7381d395cc3c56c8950104069f4874c8b4044c5994e0b13ea7e48fef",
    tx_index: 1,
    amount: [
      { unit: "lovelace", quantity: "1353340" },
      {
        unit: "e91becb9536df62eed161713311cc534ae909636ba9529b38e2a18f373746167696e67",
        quantity: "1",
      },
    ],
    inline_datum:
      "9f581c8909f41e675804f225f8aeb0615677317388b4311e5a6776b1ef971840581ccf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d400000ff",
  },
  reserveMain: {
    script: contracts.reserveTwoStage.Script,
    tx_hash: "ddac4fc13e194185b39caea80ca00bb6d3d5b52155d8ff7a3896f8b344b2e2f2",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1340410" },
      {
        unit: "d24b012f7b2a99a671b7e1196847f183982d70db02ed37068e4e49e96d61696e",
        quantity: "1",
      },
    ],
    inline_datum:
      "9f581cbef22ae3cdf56cccce6b775af9782398c4a28dc9d6a68847f42c4dda40581c00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c400000ff",
  },
  reserveStaging: {
    script: contracts.reserveTwoStage.Script,
    tx_hash: "ddac4fc13e194185b39caea80ca00bb6d3d5b52155d8ff7a3896f8b344b2e2f2",
    tx_index: 1,
    amount: [
      { unit: "lovelace", quantity: "1353340" },
      {
        unit: "d24b012f7b2a99a671b7e1196847f183982d70db02ed37068e4e49e973746167696e67",
        quantity: "1",
      },
    ],
    inline_datum:
      "9f581cbef22ae3cdf56cccce6b775af9782398c4a28dc9d6a68847f42c4dda40581ccf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d400000ff",
  },
  icsMain: {
    script: contracts.icsTwoStage.Script,
    tx_hash: "99377821b0b39f1a9e9b7d99ec701bfeb92fbc18cd4e732bc9dde66d994328a4",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1340410" },
      {
        unit: "8f2c043f857c6acb716d27d67e9cb609c9c9814b7d7b938d6c4107336d61696e",
        quantity: "1",
      },
    ],
    inline_datum:
      "9f581cc4ece55c00238e5e4f2ae3de2a41ee5b3791f4468f425debe560c98b40581c00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c400000ff",
  },
  techAuthMain: {
    script: contracts.techAuthTwoStage.Script,
    tx_hash: "82868cb4fb97b270945e4a86b933e8f3dcbd8adef6e903b8ba7fd87f02f62a1e",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1340410" },
      {
        unit: "11d1de535579d929060a22828992802c77f329470adadaec10d2490c6d61696e",
        quantity: "1",
      },
    ],
    inline_datum:
      "9f581cbc108d499a863cdebe0f725099df562a0ab064dd864e34a1359d69d040581c00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c400000ff",
  },
  techAuthStaging: {
    script: contracts.techAuthTwoStage.Script,
    tx_hash: "82868cb4fb97b270945e4a86b933e8f3dcbd8adef6e903b8ba7fd87f02f62a1e",
    tx_index: 1,
    amount: [
      { unit: "lovelace", quantity: "1353340" },
      {
        unit: "11d1de535579d929060a22828992802c77f329470adadaec10d2490c73746167696e67",
        quantity: "1",
      },
    ],
    inline_datum:
      "9f581cbc108d499a863cdebe0f725099df562a0ab064dd864e34a1359d69d040581ccf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d400000ff",
  },
} satisfies Record<string, SnapshotUtxo>;

/** The snapshot re-addressed to the testnet script address the emulator validates against. */
const snapshotScriptUtxo = (snapshot: SnapshotUtxo) =>
  TransactionUnspentOutput.fromCore([
    { txId: TransactionId(snapshot.tx_hash), index: snapshot.tx_index },
    {
      address: scriptAddress(snapshot.script),
      value: {
        coins: BigInt(
          snapshot.amount.find(({ unit }) => unit === "lovelace")!.quantity,
        ),
        assets: new Map(
          snapshot.amount
            .filter(({ unit }) => unit !== "lovelace")
            .map(({ unit, quantity }) => [AssetId(unit), BigInt(quantity)]),
        ),
      },
      datum: PlutusData.fromCbor(HexBlob(snapshot.inline_datum)).toCore(),
    },
  ]);

export const mainnetSnapshotUtxos = Record.map(
  rawSnapshots,
  snapshotScriptUtxo,
);

const inlineDatum = (utxo: TransactionUnspentOutput) =>
  utxo.output().datum()!.asInlineData()!;
const thresholdOf = (utxo: TransactionUnspentOutput) =>
  parse(Contracts.MultisigThreshold, inlineDatum(utxo));
const upgradeStateOf = (utxo: TransactionUnspentOutput) =>
  parse(Contracts.UpgradeState, inlineDatum(utxo));

export const liveThresholds = {
  main: thresholdOf(mainnetSnapshotUtxos.mainGovThreshold),
  staging: thresholdOf(mainnetSnapshotUtxos.stagingGovThreshold),
};

export const liveUpgradeStates = {
  reserve: {
    main: upgradeStateOf(mainnetSnapshotUtxos.reserveMain),
    staging: upgradeStateOf(mainnetSnapshotUtxos.reserveStaging),
  },
  ics: { main: upgradeStateOf(mainnetSnapshotUtxos.icsMain) },
};
