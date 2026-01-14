import type { TestCategory } from "../lib/types";
// Import the 6 new journey tests
import {
  governanceDeploymentAuthJourney,
  reserveDeploymentOperationsJourney,
  twoStageUpgradeJourney,
  mitigationScriptsJourney,
  stagingMainIsolationJourney,
  thresholdEffectsJourney,
} from "../journeys/index";

export const testCategories: TestCategory[] = [
  {
    id: "governance-deployment-auth",
    name: "Journey 1: Governance System Deployment & Authorization",
    description: "Deploy governance contracts (Council, TechAuth, Thresholds) and test authorization topologies",
    tests: [],
    journeys: [governanceDeploymentAuthJourney],
  },
  {
    id: "reserve-deployment-operations",
    name: "Journey 2: Reserve Deployment & Operations",
    description: "Deploy Reserve and test value-only merge operations",
    tests: [],
    journeys: [reserveDeploymentOperationsJourney],
  },
  {
    id: "two-stage-upgrade",
    name: "Journey 3: Two-Stage Upgrade Lifecycle",
    description: "Test complete upgrade system: abort, success, downgrade patterns",
    tests: [],
    journeys: [twoStageUpgradeJourney],
  },
  {
    id: "mitigation-scripts",
    name: "Journey 4: Mitigation Scripts",
    description: "Test that mitigations can be added but never removed (permanent safety)",
    tests: [],
    journeys: [mitigationScriptsJourney],
  },
  {
    id: "staging-main-isolation",
    name: "Journey 5: Staging/Main Isolation",
    description: "Test Reserve ↔ ICS interactions with complete staging/main isolation",
    tests: [],
    journeys: [stagingMainIsolationJourney],
  },
  {
    id: "threshold-effects",
    name: "Journey 6: Threshold Contract Effects",
    description: "Test that different thresholds affect only their intended operations",
    tests: [],
    journeys: [thresholdEffectsJourney],
  },
];
