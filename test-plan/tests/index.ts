import type { TestCategory } from "../lib/types";
import {
  governanceDeploymentAuthJourney,
  reserveDeploymentOperationsJourney,
  twoStageUpgradeJourney,
  mitigationScriptsJourney,
  stagingMainIsolationJourney,
  thresholdEffectsJourney,
  authUpgradeLifecycleJourney,
  thresholdEdgeCasesJourney,
  fedopsAndTermsJourney,
  cnightMintingControlJourney,
  reserveIcsTransferJourney,
} from "../journeys/index";

export const testCategories: TestCategory[] = [
  {
    id: "governance-deployment-auth",
    name: "Journey 1: Governance System Deployment & Authorization",
    description: "Deploy governance contracts (Council, TechAuth, Thresholds) and test authorization topologies",
    journeys: [governanceDeploymentAuthJourney],
  },
  {
    id: "reserve-deployment-operations",
    name: "Journey 2: Reserve Deployment & Operations",
    description: "Deploy Reserve and test value-only merge operations",
    journeys: [reserveDeploymentOperationsJourney],
  },
  {
    id: "two-stage-upgrade",
    name: "Journey 3: Two-Stage Upgrade Lifecycle",
    description: "Test complete upgrade system: abort, success, downgrade patterns",
    journeys: [twoStageUpgradeJourney],
  },
  {
    id: "mitigation-scripts",
    name: "Journey 4: Mitigation Scripts",
    description: "Test that mitigations can be added but never removed (permanent safety)",
    journeys: [mitigationScriptsJourney],
  },
  {
    id: "staging-main-isolation",
    name: "Journey 5: Staging/Main Isolation",
    description: "Test Reserve ↔ ICS interactions with complete staging/main isolation",
    journeys: [stagingMainIsolationJourney],
  },
  {
    id: "threshold-effects",
    name: "Journey 6: Threshold Contract Effects",
    description: "Test that different thresholds affect only their intended operations",
    journeys: [thresholdEffectsJourney],
  },
  {
    id: "auth-upgrade-lifecycle",
    name: "Journey 7: Auth Upgrade Lifecycle",
    description: "Test auth field staging, promotion, and downgrade via two-stage upgrade",
    journeys: [authUpgradeLifecycleJourney],
  },
  {
    id: "threshold-edge-cases",
    name: "Journey 8: Threshold Validation Edge Cases",
    description: "Test boundary conditions for threshold ratios (invalid numerator/denominator)",
    journeys: [thresholdEdgeCasesJourney],
  },
  {
    id: "fedops-and-terms",
    name: "Journey 9: FederatedOps & Terms and Conditions",
    description: "Deploy and update FederatedOps and Terms & Conditions contracts",
    journeys: [fedopsAndTermsJourney],
  },
  {
    id: "cnight-minting-control",
    name: "Journey 10: cNIGHT Minting Control",
    description: "Test cNIGHT minting lockdown with always-fails logic",
    journeys: [cnightMintingControlJourney],
  },
  {
    id: "reserve-ics-transfer",
    name: "Journey 11: Reserve <-> ICS Value Transfer",
    description: "STUB: Blocked on staging-capable Reserve/ICS contracts",
    journeys: [reserveIcsTransferJourney],
  },
];
