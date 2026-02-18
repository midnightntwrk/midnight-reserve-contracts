import type { Argv, CommandModule } from "yargs";
import type { GlobalOptions } from "../../lib/global-options";
import { extractSignersFromCbor } from "../../lib/signers";
import { buildMultisigChangeTx } from "../../lib/change-multisig";

interface ChangeCouncilOptions extends GlobalOptions {
  "tx-hash": string;
  "tx-index": number;
  sign: boolean;
  "output-file": string;
  "use-build": boolean;
}

export const command = "change-council";
export const describe = "Update council multisig members";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("tx-hash", {
      type: "string",
      demandOption: true,
      description: "Transaction hash for the fee-paying UTxO",
    })
    .option("tx-index", {
      type: "number",
      demandOption: true,
      description: "Transaction index for the fee-paying UTxO",
    })
    .option("sign", {
      type: "boolean",
      default: true,
      description:
        "Sign the transaction (requires TECH_AUTH_PRIVATE_KEYS and COUNCIL_PRIVATE_KEYS)",
    })
    .option("output-file", {
      type: "string",
      default: "change-council-tx.json",
      description: "Output file name for the transaction",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description:
        "Use build output instead of deployed-scripts versioned blueprint",
    });
}

export async function handler(argv: ChangeCouncilOptions) {
  await buildMultisigChangeTx(
    {
      commandName: "change-council",
      commandLabel: "Council",
      signDescription: "Change Council Transaction",
      primaryFamily: "council",
      signerEnvVar: "COUNCIL_SIGNERS",

      getContracts: (contracts) => ({
        primaryForever: contracts.councilForever,
        primaryTwoStage: contracts.councilTwoStage,
        primaryThreshold: contracts.mainCouncilUpdateThreshold,
        primaryLogic: contracts.councilLogic,
        secondaryForever: contracts.techAuthForever,
      }),

      getSecondarySigners: (allUtxos) => {
        const techAuthForeverUtxo = allUtxos.secondaryForever[0];
        const techAuthDatum = techAuthForeverUtxo.output().datum();
        if (!techAuthDatum?.asInlineData()) {
          throw new Error("Tech auth forever UTxO missing inline datum");
        }
        return extractSignersFromCbor(techAuthDatum.asInlineData()!);
      },
    },
    argv,
  );
}

const commandModule: CommandModule<GlobalOptions, ChangeCouncilOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
