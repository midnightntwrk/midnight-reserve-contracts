import type { Argv, CommandModule } from "yargs";
import type { GlobalOptions } from "../../lib/global-options";
import { parseUpgradeState } from "../../lib/governance-provider";
import { getDatumHandler } from "../../lib/datum-versions";
import { findUtxoWithMainAsset } from "../../lib/transaction";
import { buildMultisigChangeTx } from "../../lib/change-multisig";

interface ChangeTechAuthOptions extends GlobalOptions {
  "tx-hash": string;
  "tx-index": number;
  sign: boolean;
  "output-file": string;
  "use-build": boolean;
}

export const command = "change-tech-auth";
export const describe = "Update tech auth multisig members";

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
      default: "change-tech-auth-tx.json",
      description: "Output file name for the transaction",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description: "Use build output instead of deployed blueprint",
    });
}

export async function handler(argv: ChangeTechAuthOptions) {
  await buildMultisigChangeTx(
    {
      commandName: "change-tech-auth",
      commandLabel: "Tech Auth",
      signDescription: "Change Technical Authority Transaction",
      primaryFamily: "tech-auth",
      signerEnvVar: "TECH_AUTH_SIGNERS",

      getContracts: (contracts) => ({
        primaryForever: contracts.techAuthForever,
        primaryTwoStage: contracts.techAuthTwoStage,
        primaryThreshold: contracts.mainTechAuthUpdateThreshold,
        primaryLogic: contracts.techAuthLogic,
        secondaryForever: contracts.councilForever,
        // Need councilTwoStage to read council logicRound for version-aware signer extraction
        extraContracts: {
          councilTwoStage: contracts.councilTwoStage.Script,
        },
      }),

      getSecondarySigners: (allUtxos) => {
        // Version-aware council signer extraction:
        // Parse council two-stage datum to get logicRound, then use getDatumHandler
        const councilTwoStageUtxo = findUtxoWithMainAsset(
          allUtxos.councilTwoStage,
        );
        if (!councilTwoStageUtxo) {
          throw new Error(
            'Could not find council two-stage UTxO with "main" asset',
          );
        }

        const councilTwoStageDatum = councilTwoStageUtxo
          .output()
          .datum()
          ?.asInlineData();
        if (!councilTwoStageDatum) {
          throw new Error("Council two-stage UTxO missing inline datum");
        }

        const councilUpgradeState = parseUpgradeState(
          councilTwoStageDatum.toCbor(),
        );
        if (!councilUpgradeState) {
          throw new Error(
            "Could not parse UpgradeState from council two-stage datum",
          );
        }

        const councilForeverUtxo = allUtxos.secondaryForever[0];
        const councilDatum = councilForeverUtxo.output().datum();
        if (!councilDatum?.asInlineData()) {
          throw new Error("Council forever UTxO missing inline datum");
        }

        const councilDatumHandler = getDatumHandler(
          "council",
          councilUpgradeState.logicRound,
        );
        const councilData = councilDatumHandler.decode(
          councilDatum.asInlineData()!,
        );
        return councilData.signers;
      },
    },
    argv,
  );
}

const commandModule: CommandModule<GlobalOptions, ChangeTechAuthOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
