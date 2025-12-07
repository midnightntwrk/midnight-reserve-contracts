import type { TestCategory } from "../lib/types";
import { deploymentTests } from "./deployment";

export const testCategories: TestCategory[] = [
  {
    id: "deployment",
    name: "Contract Deployment and Upgrade",
    description: "Tests for initial deployment, upgrades, and mitigation logic",
    tests: deploymentTests,
  },
  {
    id: "cross-contract",
    name: "Cross-Contract Interactions",
    description: "Tests for interactions between different contracts",
    tests: [],
  },
];
