# Phase 07 — Private BEEFY network and RPC bootstrap (gated)

Goal: a local Midnight network with BEEFY voting, the light client
bootstrapped from its RPC, and a datum recompute check (MIP §Bootstrap,
§Acceptance criteria).

Gate: `midnight-node` on a branch with the deduplicated `u32` commitment
and the root-only payload (today `lglo/beefy-on-main` has the `beef` key;
the commitment and payload changes are node-team work). Until then this
phase runs against whatever the branch emits and records the diff in the
open-items table.

## Tasks

### 1. Stack
Copy the compact-end-2-end pattern (`infra/docker-compose.yml`,
`infra/earthly-builder.Dockerfile`, `infra/stack.ts`): the
`midnight-node-image` service runs the `node-image` Earthfile target from
`MIDNIGHT_NODE_BUILD_CONTEXT=../midnight-node` (checked out on the BEEFY
branch); the `midnight-node` service runs it with `CFG_PRESET=dev`. Place
under `tests/private-net/` with a `just private-net-up` target. A second
compose profile with 3 validators for the membership-change test (needs a
chain spec with 3 permissioned candidates carrying `beef` keys; follow
`midnight-node/docs/configuration-guide.md`).

### 2. `bridge-bootstrap --rpc ws://localhost:9944 --activation <block>`
Reads: `beefy_getFinalizedHead`; `mmr_root` at block `activation − 1`
(`mmr_root` RPC or the `MmrRoot` digest of that header); `BeefyApi.validator_set`
and `BeefyMmrLeaf` next authorities via `state_call`; committee keys with
seats from the session committee (`SessionCommitteeManagement` /
Ariadne output). Computes the deduplicated commitment with the phase 05
reference and prints the bootstrap JSON for `deploy`.

### 3. `bridge-verify-bootstrap`
Recomputes the datum from RPC and diffs it against the deployed datum
(`bridge-info`). Exit non-zero on any field mismatch. Confirms the leaf
index of block `b` is `b − 1` against `mmr_generateProof`.

### 4. Justification → update
`bridge-fetch-justification --block <n>`: `beefy_getJustification` /
block-justification store under engine `BEEF`; decode the SCALE
`VersionedFinalityProof`; drop recovery bytes; sort signatures by key;
build the multiproof and MMR proof (`mmr_generateProof`) with the phase 05
code; emit `BridgeUpdate` JSON for `bridge-update`. This is the data pump's
light-client module in TypeScript form; the node team ports it.

### 5. Soak
Run through ≥ 3 sessions on the 1-node stack (handover each session),
then the membership-change case on the 3-node stack. Record the session
length used (dev preset epoch) and any node-side deviation from the MIP
in `docs/bridge/overview.md` "What the node must emit".

## Acceptance
- `bridge-verify-bootstrap` passes on a fresh deployment; three handovers
  landed from real justifications.
- Commit: `bridge: private BEEFY network, RPC bootstrap and justification fetch`.
