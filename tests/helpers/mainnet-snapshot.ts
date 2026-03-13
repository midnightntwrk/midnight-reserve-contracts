import {
  addressFromValidator,
  AssetId,
  HexBlob,
  NetworkId,
  PaymentAddress,
  PlutusData,
  TransactionId,
  TransactionUnspentOutput,
  type Address,
  type Script,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import { loadAikenConfig } from "../../cli-yargs/lib/config";
import * as Contracts from "../../deployed-scripts/mainnet/contract_blueprint";
import { MAIN_TOKEN_HEX, STAGING_TOKEN_HEX } from "./upgrade";

export type SnapshotAmount = {
  unit: string;
  quantity: string;
};

export type SnapshotUtxo = {
  address: string;
  tx_hash: string;
  tx_index: number;
  amount: SnapshotAmount[];
  inline_datum: string | null;
  data_hash: string | null;
  reference_script_hash: string | null;
};

const ZERO_FOREVER_DATUM = PlutusData.fromCore({
  constructor: 0n,
  fields: {
    items: [
      PlutusData.newInteger(0n).toCore(),
      PlutusData.newInteger(0n).toCore(),
    ],
  },
});

const contracts = {
  techAuthForever: new Contracts.PermissionedTechAuthForeverElse(),
  councilForever: new Contracts.PermissionedCouncilForeverElse(),
  mainGovThreshold: new Contracts.ThresholdsMainGovThresholdElse(),
  stagingGovThreshold: new Contracts.ThresholdsStagingGovThresholdElse(),
  techAuthTwoStage: new Contracts.PermissionedTechAuthTwoStageUpgradeElse(),
  councilTwoStage: new Contracts.PermissionedCouncilTwoStageUpgradeElse(),
  reserveTwoStage: new Contracts.ReserveReserveTwoStageUpgradeElse(),
  reserveForever: new Contracts.ReserveReserveForeverElse(),
  icsTwoStage: new Contracts.IlliquidCirculationSupplyIcsTwoStageUpgradeElse(),
  icsForever: new Contracts.IlliquidCirculationSupplyIcsForeverElse(),
};

function toScriptAddress(script: Script): PaymentAddress {
  return PaymentAddress(
    addressFromValidator(NetworkId.Testnet, script).toBech32(),
  );
}

function toValue(amounts: SnapshotAmount[]) {
  const coins = BigInt(
    amounts.find((amount) => amount.unit === "lovelace")?.quantity ?? "0",
  );
  const assets = new Map(
    amounts
      .filter((amount) => amount.unit !== "lovelace")
      .map((amount) => [AssetId(amount.unit), BigInt(amount.quantity)]),
  );

  return {
    coins,
    ...(assets.size > 0 ? { assets } : {}),
  };
}

function snapshotToUtxo(
  snapshot: SnapshotUtxo,
  address: PaymentAddress | string = snapshot.address,
): TransactionUnspentOutput {
  return TransactionUnspentOutput.fromCore([
    {
      txId: TransactionId(snapshot.tx_hash),
      index: snapshot.tx_index,
    },
    {
      address:
        typeof address === "string"
          ? PaymentAddress(address)
          : PaymentAddress(address),
      value: toValue(snapshot.amount),
      ...(snapshot.inline_datum
        ? {
            datum: PlutusData.fromCbor(HexBlob(snapshot.inline_datum)).toCore(),
          }
        : {}),
    },
  ]);
}

function snapshotScriptUtxo(
  snapshot: SnapshotUtxo,
  script: Script,
): TransactionUnspentOutput {
  return snapshotToUtxo(snapshot, toScriptAddress(script));
}

function parseInlineDatum<T>(utxo: TransactionUnspentOutput, schema: T): T {
  const datum = utxo.output().datum()?.asInlineData();
  if (!datum) {
    throw new Error(`Missing inline datum on ${utxoRef(utxo)}`);
  }

  return parse(schema as never, datum) as T;
}

export function utxoRef(
  utxo: TransactionUnspentOutput | Pick<SnapshotUtxo, "tx_hash" | "tx_index">,
): string {
  if (utxo instanceof TransactionUnspentOutput) {
    const input = utxo.input();
    return `${input.transactionId()}#${input.index()}`;
  }

  return `${utxo.tx_hash}#${utxo.tx_index}`;
}

export function makeFundingUtxo(
  addr: Address,
  txHash: string,
  index = 0,
  coins = 900_000_000n,
): TransactionUnspentOutput {
  return TransactionUnspentOutput.fromCore([
    {
      txId: TransactionId(txHash),
      index,
    },
    {
      address: PaymentAddress(addr.toBech32()),
      value: { coins },
    },
  ]);
}

export function makeImaginaryForeverUtxo(args: {
  script: Script;
  txHash: string;
  txIndex: number;
  coins: bigint;
  cnightAmount: bigint;
  randomAssetId: AssetId;
  randomAmount: bigint;
}): TransactionUnspentOutput {
  return TransactionUnspentOutput.fromCore([
    {
      txId: TransactionId(args.txHash),
      index: args.txIndex,
    },
    {
      address: toScriptAddress(args.script),
      value: {
        coins: args.coins,
        assets: new Map([
          [cnightAssetId, args.cnightAmount],
          [args.randomAssetId, args.randomAmount],
        ]),
      },
      datum: ZERO_FOREVER_DATUM.toCore(),
    },
  ]);
}

const rawSnapshots = {
  techAuthForever: {
    address: "addr1w8umlgsw6cfkxpdk2jekzwa7rjdx7tc937mpahhyn00430s074k8y",
    tx_hash: "8dd59cc8ca3401bca9e4ab6b19d10ce31b0a9409acd890be2a359a3b272570a3",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "3710910" },
      {
        unit: "f9bfa20ed6136305b654b3613bbe1c9a6f2f058fb61edee49bdf58be",
        quantity: "1",
      },
    ],
    data_hash:
      "c56b733f2c3c8a5f8796e742986063978269163e2a746f77db47ae941f008688",
    inline_datum:
      "9f9f09a958208200581c74322a8f479106c0ef7f2a2543602c129d644f0c991f94bddd2e2cf45820b689b5d2a3d95749c545b8741c190554b5ddcefff8292dcf27c87debf02cd90958208200581c725667557cd2e066195678fd93e56aaea71cbdb590844d5a8faaac525820f2621e50bdc83a697e82980c130cabf7fbab8cbfb1da62fd87db8a393efcf50958208200581c8718058872b602bba02310d5ef4a99916420827deac7771351d941fc5820587c434a0c77f3f79894db7cc6c51f47f2ec700261e05c7fcd451d4bedb23d2158208200581ca9ddb3fe145177feb35ceae9453cab288d2ec2cb0b280880c2ae9c4258204672d7a8e458fff87e5d2dd433c7a62c015a2f10e8d2a6c47ac0124bf927f57258208200581ccbea75ab4016844c7a2374fdc29fb9563800c0dc1320df5f7f70727f58200ee4490724f7d48ae03bdcb7e03b0c034274ef6956aeb2c15ea56f90b8555e0058208200581c622384b11119f491eed796af619ea4c5269b69e9daae64ca26e66bb458203a4d7108017b3481dd0943abf05727e326d4c631c2241c959f039c64c52bab0558208200581c689f5b50a768c8d0121fa320ab2ae93f3b61c51a4409f151d32e1d4f58201283566efb9d31000839f4d3a809914ba3b448856365dfffbb69ffddd381861f58208200581c2f8f659d73afdea16f4a55ceae7414efa9a551f28b27a5fd2f9a2d8b58207687acc51495d39dade0dfcf05c243295b5be4fe916a60e181eb5fe11c595f1158208200581c0b56a67604253752c52fb1fb0ab86849246e93226aefd43054dd3169582078df3b2f01949c61383498d28de9b8e517909f5c2a6e558e4a50569c9620a266ff00ff",
    reference_script_hash: null,
  },
  councilForever: {
    address: "addr1wxg3mm3436f57r4r9t6cqdvxe0hwjusayz4ed8ulmlenttqj62ul2",
    tx_hash: "4ed658573b4c74a43b18f0c90fd04f098497048267f230decef5ad55e5060765",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "2831670" },
      {
        unit: "911dee358e934f0ea32af5803586cbeee9721d20ab969f9fdff335ac",
        quantity: "1",
      },
    ],
    data_hash:
      "89a08f25e812751e31a321e6a528b885e886e01f74c1a58439a154fc0f6521a1",
    inline_datum:
      "9f9f06a658208200581c4ab24e49cec6bf57c3b672d621a19159dfbe05c1e8285a89b1105feb582002f07a50bcbcfa638171dd27f269c49d54e800ac87be4e2165d310129667bc5a58208200581cf5d31fd3054fe149a0761563a877c58ef755e8d24969e90c4dc13db85820c0e64f983bf729b000b9e8de94ecdc2d4a6b7155f43cf0c5d61672b40773040858208200581cb3b48a9d8140510133b0670e52f15fe414c91cbc87ee9609ba7330f6582024f2ac438bd054b7d931f6435b4e5145caadac82ec294226402715b2136e830658208200581cb1dc5c62c0cc8efd0683b583b7fbf720cb6f4fad0c5b335c2e82d6235820587c434a0c77f3f79894db7cc6c51f47f2ec700261e05c7fcd451d4bedb23d2158208200581c7465c949127a8e63526d3aa24a04b04644a834eda93c800e141bed6e58203a4d7108017b3481dd0943abf05727e326d4c631c2241c959f039c64c52bab0558208200581c1933851734e658dec58b51cce1a14a218979f2f7bb1c5bb06146b76e582064b1dc75b2bdbb29a85503020589861fb7f42659babced93cd8a46b30ec59f75ff00ff",
    reference_script_hash: null,
  },
  mainGovThreshold: {
    address: "addr1wx7s6wrrw7wjuf7lc7lcj5llfyvhjqxc4mu70mzde2qwtccqlgket",
    tx_hash: "8ae50d9066a4c404f0e89cc5c732ba41f6b07e693f7f0d1d48cac2c41954a1a2",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1060260" },
      {
        unit: "bd0d3863779d2e27dfc7bf8953ff49197900d8aef9e7ec4dca80e5e3",
        quantity: "1",
      },
    ],
    data_hash:
      "3d33ec2a8e77b60519e647d05bcce3e6d8d5e95fb61d87ccb712d71f79cd96f9",
    inline_datum: "9f02030203ff",
    reference_script_hash: null,
  },
  stagingGovThreshold: {
    address: "addr1wyytylt6wn3g2npsyn0anche4433swpw4qxct7gyhvcd74sjstvmr",
    tx_hash: "68058a74ec5438b99880673e621cb50e515a139a01e1da15b2fe8d43076b3100",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1060260" },
      {
        unit: "08b27d7a74e2854c3024dfd9e2f9ad6318382ea80d85f904bb30df56",
        quantity: "1",
      },
    ],
    data_hash:
      "e9e9632d2f92fcf7cd8c487d80720972c054bd4691e630a47ef4744ed3fa13eb",
    inline_datum: "9f01020001ff",
    reference_script_hash: null,
  },
  councilMain: {
    address: "addr1w853hm9e2dklvthdzct3xvguc562ayykx6af22dn3c4p3ucuk40tz",
    tx_hash: "d707ea8f7381d395cc3c56c8950104069f4874c8b4044c5994e0b13ea7e48fef",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1340410" },
      {
        unit: "e91becb9536df62eed161713311cc534ae909636ba9529b38e2a18f36d61696e",
        quantity: "1",
      },
    ],
    data_hash:
      "b2a2711e3975456baf945543f72c041714bc6bbac949a1f4828d6d6d7516ded3",
    inline_datum:
      "9f581c8909f41e675804f225f8aeb0615677317388b4311e5a6776b1ef971840581c00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c400000ff",
    reference_script_hash: null,
  },
  councilStaging: {
    address: "addr1w853hm9e2dklvthdzct3xvguc562ayykx6af22dn3c4p3ucuk40tz",
    tx_hash: "d707ea8f7381d395cc3c56c8950104069f4874c8b4044c5994e0b13ea7e48fef",
    tx_index: 1,
    amount: [
      { unit: "lovelace", quantity: "1353340" },
      {
        unit: "e91becb9536df62eed161713311cc534ae909636ba9529b38e2a18f373746167696e67",
        quantity: "1",
      },
    ],
    data_hash:
      "67d5c7169fc8105f4bedea3fb6e1f1ca45cabba0b122c60bb4809af436319051",
    inline_datum:
      "9f581c8909f41e675804f225f8aeb0615677317388b4311e5a6776b1ef971840581ccf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d400000ff",
    reference_script_hash: null,
  },
  reserveMain: {
    address: "addr1w8fykqf00v4fnfn3kls3j6z87xpesttsmvpw6dcx3e8yn6gv7mhxj",
    tx_hash: "ddac4fc13e194185b39caea80ca00bb6d3d5b52155d8ff7a3896f8b344b2e2f2",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1340410" },
      {
        unit: "d24b012f7b2a99a671b7e1196847f183982d70db02ed37068e4e49e96d61696e",
        quantity: "1",
      },
    ],
    data_hash:
      "050034a5746f94b5ac739618f8e0f87a0aa3b0429f0af9c386271de78e13a0d1",
    inline_datum:
      "9f581cbef22ae3cdf56cccce6b775af9782398c4a28dc9d6a68847f42c4dda40581c00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c400000ff",
    reference_script_hash: null,
  },
  reserveStaging: {
    address: "addr1w8fykqf00v4fnfn3kls3j6z87xpesttsmvpw6dcx3e8yn6gv7mhxj",
    tx_hash: "ddac4fc13e194185b39caea80ca00bb6d3d5b52155d8ff7a3896f8b344b2e2f2",
    tx_index: 1,
    amount: [
      { unit: "lovelace", quantity: "1353340" },
      {
        unit: "d24b012f7b2a99a671b7e1196847f183982d70db02ed37068e4e49e973746167696e67",
        quantity: "1",
      },
    ],
    data_hash:
      "23103bdaba6816a56e2a5795d4e603a493be9815fe6183e26f096f96b172706e",
    inline_datum:
      "9f581cbef22ae3cdf56cccce6b775af9782398c4a28dc9d6a68847f42c4dda40581ccf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d400000ff",
    reference_script_hash: null,
  },
  icsMain: {
    address: "addr1wx8jcppls47x4jm3d5navl5ukcyunjvpfd7hhyudd3qswvcmx0ql5",
    tx_hash: "99377821b0b39f1a9e9b7d99ec701bfeb92fbc18cd4e732bc9dde66d994328a4",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1340410" },
      {
        unit: "8f2c043f857c6acb716d27d67e9cb609c9c9814b7d7b938d6c4107336d61696e",
        quantity: "1",
      },
    ],
    data_hash:
      "7971cb8a6e663be619eda91c63c13b5c38a824f56036a165c70ca5f7fd6de2ed",
    inline_datum:
      "9f581cc4ece55c00238e5e4f2ae3de2a41ee5b3791f4468f425debe560c98b40581c00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c400000ff",
    reference_script_hash: null,
  },
  icsStaging: {
    address: "addr1wx8jcppls47x4jm3d5navl5ukcyunjvpfd7hhyudd3qswvcmx0ql5",
    tx_hash: "99377821b0b39f1a9e9b7d99ec701bfeb92fbc18cd4e732bc9dde66d994328a4",
    tx_index: 1,
    amount: [
      { unit: "lovelace", quantity: "1353340" },
      {
        unit: "8f2c043f857c6acb716d27d67e9cb609c9c9814b7d7b938d6c41073373746167696e67",
        quantity: "1",
      },
    ],
    data_hash:
      "ec1d0154a0d927a32fefa7b593205ee6ff6ba1c52ffc3b3befecc7ed298895d5",
    inline_datum:
      "9f581cc4ece55c00238e5e4f2ae3de2a41ee5b3791f4468f425debe560c98b40581ccf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d400000ff",
    reference_script_hash: null,
  },
  techAuthMain: {
    address: "addr1wygarhjn24uaj2gxpg3g9zvjsqk80uefgu9d4khvzrfyjrqw3uwdr",
    tx_hash: "82868cb4fb97b270945e4a86b933e8f3dcbd8adef6e903b8ba7fd87f02f62a1e",
    tx_index: 0,
    amount: [
      { unit: "lovelace", quantity: "1340410" },
      {
        unit: "11d1de535579d929060a22828992802c77f329470adadaec10d2490c6d61696e",
        quantity: "1",
      },
    ],
    data_hash:
      "bb36f46d777b3437aa0a4d0135f3889cd84c4eef28d534e3a3f4b0c7d1ddb879",
    inline_datum:
      "9f581cbc108d499a863cdebe0f725099df562a0ab064dd864e34a1359d69d040581c00d92f55c57d6d95f863202885e76304e6ef970767249413561b289c400000ff",
    reference_script_hash: null,
  },
  techAuthStaging: {
    address: "addr1wygarhjn24uaj2gxpg3g9zvjsqk80uefgu9d4khvzrfyjrqw3uwdr",
    tx_hash: "82868cb4fb97b270945e4a86b933e8f3dcbd8adef6e903b8ba7fd87f02f62a1e",
    tx_index: 1,
    amount: [
      { unit: "lovelace", quantity: "1353340" },
      {
        unit: "11d1de535579d929060a22828992802c77f329470adadaec10d2490c73746167696e67",
        quantity: "1",
      },
    ],
    data_hash:
      "a63fff2aed98dc5addc098410f744c2a5a8ec3c96ef28669f75fdfe63e9b5f61",
    inline_datum:
      "9f581cbc108d499a863cdebe0f725099df562a0ab064dd864e34a1359d69d040581ccf44e0802c37dc8db33f80526edd3e0bdb1aa142b214e5c19f2f518d400000ff",
    reference_script_hash: null,
  },
} satisfies Record<string, SnapshotUtxo>;

export const mainnetSnapshotUtxos = {
  techAuthForever: snapshotScriptUtxo(
    rawSnapshots.techAuthForever,
    contracts.techAuthForever.Script,
  ),
  councilForever: snapshotScriptUtxo(
    rawSnapshots.councilForever,
    contracts.councilForever.Script,
  ),
  mainGovThreshold: snapshotScriptUtxo(
    rawSnapshots.mainGovThreshold,
    contracts.mainGovThreshold.Script,
  ),
  stagingGovThreshold: snapshotScriptUtxo(
    rawSnapshots.stagingGovThreshold,
    contracts.stagingGovThreshold.Script,
  ),
  councilMain: snapshotScriptUtxo(
    rawSnapshots.councilMain,
    contracts.councilTwoStage.Script,
  ),
  councilStaging: snapshotScriptUtxo(
    rawSnapshots.councilStaging,
    contracts.councilTwoStage.Script,
  ),
  reserveMain: snapshotScriptUtxo(
    rawSnapshots.reserveMain,
    contracts.reserveTwoStage.Script,
  ),
  reserveStaging: snapshotScriptUtxo(
    rawSnapshots.reserveStaging,
    contracts.reserveTwoStage.Script,
  ),
  icsMain: snapshotScriptUtxo(
    rawSnapshots.icsMain,
    contracts.icsTwoStage.Script,
  ),
  icsStaging: snapshotScriptUtxo(
    rawSnapshots.icsStaging,
    contracts.icsTwoStage.Script,
  ),
  techAuthMain: snapshotScriptUtxo(
    rawSnapshots.techAuthMain,
    contracts.techAuthTwoStage.Script,
  ),
  techAuthStaging: snapshotScriptUtxo(
    rawSnapshots.techAuthStaging,
    contracts.techAuthTwoStage.Script,
  ),
};

export const liveMultisigStates: {
  techAuth: Contracts.VersionedMultisig;
  council: Contracts.VersionedMultisig;
} = {
  techAuth: parseInlineDatum(
    mainnetSnapshotUtxos.techAuthForever,
    Contracts.VersionedMultisig,
  ) as unknown as Contracts.VersionedMultisig,
  council: parseInlineDatum(
    mainnetSnapshotUtxos.councilForever,
    Contracts.VersionedMultisig,
  ) as unknown as Contracts.VersionedMultisig,
};

export const liveThresholds: {
  main: Contracts.MultisigThreshold;
  staging: Contracts.MultisigThreshold;
} = {
  main: parseInlineDatum(
    mainnetSnapshotUtxos.mainGovThreshold,
    Contracts.MultisigThreshold,
  ) as unknown as Contracts.MultisigThreshold,
  staging: parseInlineDatum(
    mainnetSnapshotUtxos.stagingGovThreshold,
    Contracts.MultisigThreshold,
  ) as unknown as Contracts.MultisigThreshold,
};

export const liveUpgradeStates: {
  council: { main: Contracts.UpgradeState; staging: Contracts.UpgradeState };
  reserve: { main: Contracts.UpgradeState; staging: Contracts.UpgradeState };
  ics: { main: Contracts.UpgradeState; staging: Contracts.UpgradeState };
  techAuth: { main: Contracts.UpgradeState; staging: Contracts.UpgradeState };
} = {
  council: {
    main: parseInlineDatum(
      mainnetSnapshotUtxos.councilMain,
      Contracts.UpgradeState,
    ) as unknown as Contracts.UpgradeState,
    staging: parseInlineDatum(
      mainnetSnapshotUtxos.councilStaging,
      Contracts.UpgradeState,
    ) as unknown as Contracts.UpgradeState,
  },
  reserve: {
    main: parseInlineDatum(
      mainnetSnapshotUtxos.reserveMain,
      Contracts.UpgradeState,
    ) as unknown as Contracts.UpgradeState,
    staging: parseInlineDatum(
      mainnetSnapshotUtxos.reserveStaging,
      Contracts.UpgradeState,
    ) as unknown as Contracts.UpgradeState,
  },
  ics: {
    main: parseInlineDatum(
      mainnetSnapshotUtxos.icsMain,
      Contracts.UpgradeState,
    ) as unknown as Contracts.UpgradeState,
    staging: parseInlineDatum(
      mainnetSnapshotUtxos.icsStaging,
      Contracts.UpgradeState,
    ) as unknown as Contracts.UpgradeState,
  },
  techAuth: {
    main: parseInlineDatum(
      mainnetSnapshotUtxos.techAuthMain,
      Contracts.UpgradeState,
    ) as unknown as Contracts.UpgradeState,
    staging: parseInlineDatum(
      mainnetSnapshotUtxos.techAuthStaging,
      Contracts.UpgradeState,
    ) as unknown as Contracts.UpgradeState,
  },
};

const aikenConfig = loadAikenConfig("mainnet");
export const cnightAssetId = AssetId(
  aikenConfig.cnight_policy +
    Buffer.from(aikenConfig.cnight_name).toString("hex"),
);

export const mainnetReviewRefs = Object.fromEntries(
  Object.entries(rawSnapshots).map(([name, snapshot]) => [
    name,
    utxoRef(snapshot),
  ]),
);

export const mainnetTokenAssetIds = {
  councilMain: AssetId(
    contracts.councilTwoStage.Script.hash() + MAIN_TOKEN_HEX,
  ),
  councilStaging: AssetId(
    contracts.councilTwoStage.Script.hash() + STAGING_TOKEN_HEX,
  ),
  reserveMain: AssetId(
    contracts.reserveTwoStage.Script.hash() + MAIN_TOKEN_HEX,
  ),
  reserveStaging: AssetId(
    contracts.reserveTwoStage.Script.hash() + STAGING_TOKEN_HEX,
  ),
  icsMain: AssetId(contracts.icsTwoStage.Script.hash() + MAIN_TOKEN_HEX),
  icsStaging: AssetId(contracts.icsTwoStage.Script.hash() + STAGING_TOKEN_HEX),
  techAuthMain: AssetId(
    contracts.techAuthTwoStage.Script.hash() + MAIN_TOKEN_HEX,
  ),
  techAuthStaging: AssetId(
    contracts.techAuthTwoStage.Script.hash() + STAGING_TOKEN_HEX,
  ),
};

export const zeroForeverDatum = ZERO_FOREVER_DATUM;
export const mainnetRawSnapshots = rawSnapshots;
