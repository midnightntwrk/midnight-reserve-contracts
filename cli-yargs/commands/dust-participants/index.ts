import type { Argv, CommandModule } from "yargs";
import type { GlobalOptions } from "../../lib/global-options";
import {
  getContractInstances,
  getCredentialAddress,
} from "../../lib/contracts";
import { getCardanoNetwork } from "../../lib/network-mapping";
import {
  blockfrostFetch,
  getBlockfrostBaseUrl,
  parseBlockfrostAddressUtxos,
  type BlockfrostAddressUtxo,
} from "../../lib/blockfrost";

interface DustParticipantsOptions extends GlobalOptions {
  format: string;
  "use-build": boolean;
}

async function fetchAllAddressUtxos(
  baseUrl: string,
  apiKey: string,
  address: string,
): Promise<BlockfrostAddressUtxo[]> {
  const allUtxos: BlockfrostAddressUtxo[] = [];
  let page = 1;
  while (true) {
    const result = await blockfrostFetch(
      baseUrl,
      apiKey,
      `/addresses/${address}/utxos?count=100&page=${page}`,
    );
    if (result === null) break;
    const batch = parseBlockfrostAddressUtxos(
      result,
      `/addresses/${address}/utxos?count=100&page=${page}`,
    );
    if (batch.length === 0) break;
    allUtxos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return allUtxos;
}

export const command = "dust-participants";
export const describe =
  "Count registered dust participants from cnight_generates_dust UTxOs";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("format", {
      type: "string",
      default: "table",
      choices: ["json", "table"] as const,
      description: "Output format: json or table",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description: "Use build output instead of deployed blueprint",
    });
}

export async function handler(argv: DustParticipantsOptions) {
  const { network, format, "use-build": useBuild } = argv;

  const contracts = getContractInstances(network, useBuild);
  if (!contracts.cnightGeneratesDust) {
    throw new Error(
      `cnight_generates_dust contract not found in blueprint for '${network}'.`,
    );
  }

  const policyId = contracts.cnightGeneratesDust.Script.hash();
  const address = getCredentialAddress(network, policyId).toBech32();

  const cardanoNetwork = getCardanoNetwork(network);
  if (!cardanoNetwork || cardanoNetwork === "local") {
    throw new Error(
      `Cannot query on-chain data for environment '${network}'. ` +
        `Use a real network like preview, preprod, or mainnet.`,
    );
  }

  const apiKeyVar = `BLOCKFROST_${cardanoNetwork.toUpperCase()}_API_KEY`;
  const apiKey = process.env[apiKeyVar];
  if (!apiKey) {
    throw new Error(
      `Environment variable ${apiKeyVar} is required but not set.`,
    );
  }

  const baseUrl = getBlockfrostBaseUrl(cardanoNetwork);

  if (format !== "json") {
    console.log(`\nQuerying dust participants for ${network} network...\n`);
    console.log(`  Policy ID: ${policyId}`);
    console.log(`  Address:   ${address}\n`);
  }

  const utxos = await fetchAllAddressUtxos(baseUrl, apiKey, address);

  // Filter UTxOs that contain a token under the cnight_generates_dust policy
  const dustUtxos = utxos.filter((utxo) =>
    utxo.amount.some(
      (amt) => amt.unit !== "lovelace" && amt.unit.startsWith(policyId),
    ),
  );

  const participantCount = dustUtxos.length;

  if (format === "json") {
    console.log(
      JSON.stringify(
        {
          network,
          policyId,
          address,
          totalUtxos: utxos.length,
          participantCount,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`  Total UTxOs at address: ${utxos.length}`);
    console.log(`  UTxOs with dust token:  ${dustUtxos.length}`);
    console.log(`\n  Registered dust participants: ${participantCount}\n`);
  }
}

const commandModule: CommandModule<GlobalOptions, DustParticipantsOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
