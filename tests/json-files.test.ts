import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { Glob } from "bun";
import { Either } from "effect";
import { decodeJson } from "../cli/input";
import { DeploymentFile } from "../cli/chain/tx-file";
import {
  Changelog,
  PlutusJson,
  VersionsJson,
} from "../cli/contracts/plutus-json";

const files = (pattern: string) => [...new Glob(pattern).scanSync(".")];

describe("plutus.json", () => {
  const plutusFiles = [
    ...files("plutus*.json"),
    ...files("deployed-scripts/*/plutus.json"),
  ];

  test("every blueprint in the repository writes back what it read", () => {
    expect(plutusFiles.length).toBeGreaterThan(10);
    for (const path of plutusFiles) {
      const text = readFileSync(path, "utf-8");
      const decoded = Either.getOrThrow(decodeJson(PlutusJson)(text));
      expect(JSON.stringify(decoded, null, 2)).toBe(
        JSON.stringify(JSON.parse(text), null, 2),
      );
    }
  });
});

describe("versions.json", () => {
  test("every snapshot in the repository decodes", () => {
    for (const path of files("deployed-scripts/*/versions.json")) {
      expect(
        Either.isRight(decodeJson(VersionsJson)(readFileSync(path, "utf-8"))),
      ).toBe(true);
    }
  });
});

describe("changelog.json", () => {
  test("every snapshot changelog in the repository decodes, so an extend can append to it", () => {
    const changelogs = files("deployed-scripts/*/changelog.json");
    expect(changelogs.length).toBeGreaterThan(0);
    for (const path of changelogs) {
      expect(
        Either.isRight(decodeJson(Changelog)(readFileSync(path, "utf-8"))),
      ).toBe(true);
    }
  });
});

describe("deployment files", () => {
  test("every deployment file in the repository decodes", () => {
    const deploymentFiles = files("deployments/**/*deployment*.json");
    expect(deploymentFiles.length).toBeGreaterThan(5);
    for (const path of deploymentFiles) {
      expect(
        Either.isRight(decodeJson(DeploymentFile)(readFileSync(path, "utf-8"))),
      ).toBe(true);
    }
  });
});
