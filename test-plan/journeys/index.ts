/**
 * Journey Test Index
 *
 * Exports all journey definitions for the test runner.
 *
 * JOURNEY ORGANIZATION:
 *
 * Journeys are organized to tell coherent lifecycle stories:
 *
 * 1. Governance Deployment & Authorization
 *    - Deploy Council, TechAuth, Thresholds
 *    - Test various multisig topologies (1-of-1, M-of-N, weighted, 0-of-N, 3-deep tree)
 *
 * 2. Reserve Deployment & Operations
 *    - Deploy Reserve (depends on Journey 1)
 *    - Test value-only operations (can add, cannot remove)
 *    - Test governance authorization
 *
 * 3. Two-Stage Upgrade Lifecycle
 *    - Abort logic pattern
 *    - Successful upgrade (stage → test → promote)
 *    - Downgrade flow
 *    - NFT constraints
 *
 * 4. Mitigation Scripts
 *    - Add mitigation logic/auth
 *    - Verify they're enforced
 *    - Verify they cannot be removed (permanent)
 *
 * 5. Staging/Main Isolation (Reserve ↔ ICS)
 *    - Deploy test + real ICS
 *    - Test staging Reserve with test ICS
 *    - Promote Reserve
 *    - Test main Reserve with real ICS
 *    - Verify isolation (staging can't use real, main can't use test)
 *
 * 6. Threshold Contract Effects
 *    - Update different thresholds
 *    - Verify each affects only intended operations
 *    - Test 0-of-N edge case
 *
 * EXECUTION ORDER:
 * - Journey 1 must run first (deploys governance)
 * - Journey 2 depends on Journey 1 (needs governance)
 * - Journeys 3-6 depend on Journeys 1-2 (need full deployment)
 * - Journeys can optionally reuse contracts from previous journeys
 *
 * DEPENDENCIES:
 * - Each journey can set reuseContracts: true to reuse deployments
 * - Journey state is passed through ctx.journeyState
 * - Deployments are stored in ctx.journeyState.deployments
 */

export { governanceDeploymentAuthJourney } from "./1-governance-deployment-auth";
export { reserveDeploymentOperationsJourney } from "./2-reserve-deployment-operations";
export { twoStageUpgradeJourney } from "./3-two-stage-upgrade";
export { mitigationScriptsJourney } from "./4-mitigation-scripts";
export { stagingMainIsolationJourney } from "./5-staging-main-isolation";
export { thresholdEffectsJourney } from "./6-threshold-effects";

// Export all journeys as an array for easy iteration
import { governanceDeploymentAuthJourney } from "./1-governance-deployment-auth";
import { reserveDeploymentOperationsJourney } from "./2-reserve-deployment-operations";
import { twoStageUpgradeJourney } from "./3-two-stage-upgrade";
import { mitigationScriptsJourney } from "./4-mitigation-scripts";
import { stagingMainIsolationJourney } from "./5-staging-main-isolation";
import { thresholdEffectsJourney } from "./6-threshold-effects";

export const allJourneys = [
  governanceDeploymentAuthJourney,
  reserveDeploymentOperationsJourney,
  twoStageUpgradeJourney,
  mitigationScriptsJourney,
  stagingMainIsolationJourney,
  thresholdEffectsJourney,
];
