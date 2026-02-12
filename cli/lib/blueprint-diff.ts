import { Script } from "@blaze-cardano/core";

export interface BlueprintContract {
  className: string;
  script: Script;
  hash: string;
}

export interface BlueprintDiff {
  added: BlueprintContract[]; // in build but not in deployed
  changed: BlueprintContract[]; // same class name, different hash
  unchanged: BlueprintContract[]; // same class name and hash
}

/**
 * Enumerates all contract classes from a loaded blueprint module.
 * Filters for exported constructor functions, instantiates each,
 * and extracts the Script and its hash.
 */
export function enumerateContracts(
  module: Record<string, unknown>,
): BlueprintContract[] {
  const contracts: BlueprintContract[] = [];

  for (const [className, exported] of Object.entries(module)) {
    if (typeof exported !== "function") continue;

    try {
      const instance = new (exported as new () => { Script: Script })();
      if (!instance.Script || typeof instance.Script.hash !== "function")
        continue;

      contracts.push({
        className,
        script: instance.Script,
        hash: instance.Script.hash(),
      });
    } catch {
      // Some constructors require arguments (parameterized validators) — skip them
    }
  }

  return contracts;
}

/**
 * Diffs two blueprint modules to find added, changed, and unchanged contracts.
 *
 * @param deployed - The currently deployed blueprint module
 * @param build - The new build blueprint module
 */
export function diffBlueprints(
  deployed: Record<string, unknown>,
  build: Record<string, unknown>,
): BlueprintDiff {
  const deployedContracts = enumerateContracts(deployed);
  const buildContracts = enumerateContracts(build);

  const deployedMap = new Map<string, string>();
  for (const c of deployedContracts) {
    deployedMap.set(c.className, c.hash);
  }

  const added: BlueprintContract[] = [];
  const changed: BlueprintContract[] = [];
  const unchanged: BlueprintContract[] = [];

  for (const c of buildContracts) {
    const deployedHash = deployedMap.get(c.className);
    if (deployedHash === undefined) {
      added.push(c);
    } else if (deployedHash !== c.hash) {
      changed.push(c);
    } else {
      unchanged.push(c);
    }
  }

  return { added, changed, unchanged };
}

/**
 * Finds a contract by its script hash in a blueprint module.
 *
 * @param module - The loaded blueprint module to search
 * @param hash - The script hash to find
 */
export function findContractByHash(
  module: Record<string, unknown>,
  hash: string,
): BlueprintContract | null {
  const contracts = enumerateContracts(module);
  return contracts.find((c) => c.hash === hash) ?? null;
}
