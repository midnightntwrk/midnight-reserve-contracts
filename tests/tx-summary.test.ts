import { describe, test, expect } from "bun:test";
import { renderMarkdown } from "../cli-yargs/lib/tx-summary/markdown";
import { detectCommandType } from "../cli-yargs/lib/tx-summary/semantic";
import type { SemanticDiff } from "../cli-yargs/lib/tx-summary/semantic";
import type { ResolvedInput } from "../cli-yargs/lib/tx-summary/resolve-inputs";
import type { TransactionOutput } from "../cli-yargs/lib/types";

const mockTxJson: TransactionOutput = {
  type: "Tx ConwayEra",
  description: "Change federated ops",
  cborHex: "84a400",
  txHash: "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
  signed: false,
};

const mockStructuralJson = {
  fee: "Coin 200000",
  auxiliaryData: {
    metadata: {
      "674": {
        msg: ["midnight-reserve:change-federated-ops"],
      },
    },
  },
};

describe("tx-summary", () => {
  describe("detectCommandType", () => {
    test("detects command type from structural JSON metadata", () => {
      const result = detectCommandType(mockStructuralJson);
      expect(result).toBe("change-federated-ops");
    });

    test("detects change-council command type", () => {
      const json = {
        metadata: { "674": { msg: ["midnight-reserve:change-council"] } },
      };
      expect(detectCommandType(json)).toBe("change-council");
    });

    test("returns null when no metadata present", () => {
      const json = { fee: "Coin 200000" };
      expect(detectCommandType(json)).toBeNull();
    });

    test("returns null when metadata has no midnight-reserve prefix", () => {
      const json = { metadata: { "674": { msg: ["some-other-thing"] } } };
      expect(detectCommandType(json)).toBeNull();
    });
  });

  describe("renderMarkdown", () => {
    test("renders basic transaction summary table", () => {
      const md = renderMarkdown(mockTxJson, mockStructuralJson, [], null);

      expect(md).toContain("## Transaction Summary");
      expect(md).toContain("| **Description** | Change federated ops |");
      expect(md).toContain(`| **Tx Hash** | \`${mockTxJson.txHash}\` |`);
      expect(md).toContain("| **Signed** | No |");
      expect(md).toContain("| **Fee** | Coin 200000 |");
    });

    test("renders structural JSON in collapsible section", () => {
      const md = renderMarkdown(mockTxJson, mockStructuralJson, [], null);

      expect(md).toContain("### Full Transaction (cardano-cli)");
      expect(md).toContain("<details><summary>Click to expand</summary>");
      expect(md).toContain("```json");
      expect(md).toContain('"fee": "Coin 200000"');
      expect(md).toContain("</details>");
    });

    test("renders resolved spend inputs", () => {
      const inputs: ResolvedInput[] = [
        {
          txHash:
            "aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd",
          index: 0,
          address:
            "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp",
          lovelace: "5000000",
          ada: "5.000000",
          tokens: [
            {
              policyId: "a".repeat(56),
              assetName: "token1",
              quantity: "1",
            },
          ],
          inlineDatum: "d8799f00ff",
          isReferenceInput: false,
        },
      ];

      const md = renderMarkdown(mockTxJson, mockStructuralJson, inputs, null);

      expect(md).toContain("### Inputs (1)");
      expect(md).toContain("5.000000 ADA");
      expect(md).toContain("+ 1 token(s)");
      expect(md).toContain("(has inline datum)");
      expect(md).toContain("Address:");
    });

    test("renders resolved reference inputs", () => {
      const inputs: ResolvedInput[] = [
        {
          txHash:
            "1122334411223344112233441122334411223344112233441122334411223344",
          index: 2,
          address: "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer",
          lovelace: "2000000",
          ada: "2.000000",
          tokens: [],
          inlineDatum: null,
          isReferenceInput: true,
        },
      ];

      const md = renderMarkdown(mockTxJson, mockStructuralJson, inputs, null);

      expect(md).toContain("### Reference Inputs (1)");
      expect(md).toContain("2.000000 ADA");
    });

    test("renders semantic diff with added/removed/unchanged", () => {
      const diff: SemanticDiff = {
        commandType: "change-federated-ops",
        changes: [
          {
            type: "added",
            description: "Candidate aabb112233445566...",
            detail: {
              sidechain_pub_key: "aabb112233445566aabb112233445566",
              aura_pub_key: "1111",
            },
          },
          {
            type: "removed",
            description: "Candidate ccdd778899001122...",
            detail: { sidechain_pub_key: "ccdd778899001122ccdd778899001122" },
          },
          {
            type: "unchanged",
            description: "Candidate eeff334455667788...",
          },
        ],
      };

      const md = renderMarkdown(mockTxJson, mockStructuralJson, [], diff);

      expect(md).toContain("## On-Chain Diff: change-federated-ops");
      expect(md).toContain("**Count: 2 -> 2**");
      expect(md).toContain("### Added (1)");
      expect(md).toContain("### Removed (1)");
      expect(md).toContain("Unchanged (1)");
      expect(md).toContain(
        "`sidechain_pub_key`: `aabb112233445566aabb112233445566`",
      );
    });

    test("skips semantic diff section when null", () => {
      const md = renderMarkdown(mockTxJson, mockStructuralJson, [], null);

      expect(md).not.toContain("On-Chain Diff");
    });

    test("skips semantic diff section when changes array is empty", () => {
      const diff: SemanticDiff = {
        commandType: "unknown-command",
        changes: [],
      };

      const md = renderMarkdown(mockTxJson, mockStructuralJson, [], diff);

      expect(md).not.toContain("On-Chain Diff");
    });
  });
});
