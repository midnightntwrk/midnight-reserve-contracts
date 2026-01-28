import type {
  JourneyDefinition,
  JourneyContext,
  TestResult,
} from "../lib/types";
import {
  initTestResult,
  completeTestResult,
} from "../lib/test-helpers";

/**
 * Journey 11: Reserve <-> ICS Value Transfer
 *
 * STATUS: STUB - Blocked on staging-capable Reserve/ICS contracts.
 *
 * Currently, Reserve and ICS contracts are hard-coded for main-only operation.
 * Once staging-capable versions land, this journey will test:
 *
 * 1. Deploy governance + Reserve + ICS contracts
 * 2. Fund Reserve with cNIGHT tokens
 * 3. Transfer cNIGHT from Reserve to ICS (requires multisig + logic withdrawal)
 * 4. Transfer cNIGHT from ICS back to Reserve
 * 5. Verify balance accounting across both contracts
 * 6. Test staging upgrade path for Reserve/ICS logic
 *
 * The Reserve logic uses `logic_merge` for consolidating UTxOs and
 * validates cNIGHT balance preservation. The ICS follows the same pattern.
 *
 * Key contract interactions:
 * - Reserve forever spending requires logic + mitigation_logic withdrawals
 * - Reserve logic withdrawal validates cNIGHT + ADA balance preservation
 * - ICS follows the same architecture
 * - Both share the same gov_auth for authorization
 *
 * Prerequisites (blocked):
 * - Reserve/ICS contracts that support both main and staging two-stage paths
 * - Currently these use `logic_is_on_main` which is hard-coded
 */
export const reserveIcsTransferJourney: JourneyDefinition = {
  id: "reserve-ics-transfer",
  name: "Reserve <-> ICS Value Transfer",
  description: "STUB: Blocked on staging-capable Reserve/ICS contracts",
  reuseContracts: false,
  steps: [
    {
      id: "stub-notice",
      name: "Stub: Reserve/ICS transfer tests pending",
      description: "Blocked on staging-capable Reserve/ICS contracts",
      async execute(_ctx: JourneyContext): Promise<TestResult> {
        const result = initTestResult("stub-notice", this.name);

        console.log("  Reserve <-> ICS Value Transfer journey is STUBBED");
        console.log("  Blocked on staging-capable Reserve/ICS contracts");
        console.log("");
        console.log("  When staging changes land, this journey will test:");
        console.log("    1. Deploy governance + Reserve + ICS");
        console.log("    2. Fund Reserve with cNIGHT tokens");
        console.log("    3. Transfer cNIGHT from Reserve to ICS");
        console.log("    4. Transfer cNIGHT from ICS to Reserve");
        console.log("    5. Verify balance accounting");
        console.log("    6. Test staging upgrade path");

        return completeTestResult(
          result,
          "skipped",
          "Blocked on staging-capable Reserve/ICS contracts. See journey comments for planned tests."
        );
      },
    },
  ],
};
