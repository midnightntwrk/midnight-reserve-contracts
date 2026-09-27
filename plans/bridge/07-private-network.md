# Phase 07 — Private BEEFY network and RPC bootstrap (gated)

Goal: a local Midnight network with BEEFY voting, the light client
bootstrapped from its RPC, and a datum recompute check (MIP §Bootstrap,
§Acceptance criteria).

Gate: `midnight-node` on a branch with the deduplicated `u32` commitment
and the root-only payload. `kc-beefy-mip-alignment` (four local commits on
`lglo/beefy-on-main`, for a PR to that branch, 2026-09-27) has them, plus
Session hooks before Mmr (rule 10) and `beef` keys for the mock candidates.
A local dev node checked each against the base: payload `mh` only (48-byte
commitment), `BeefyMmrApi_authority_set_proof` the seat commitment (dev
Alice holds 10 seats: one leaf, `len` 10), the leaf added by a session's
first block names the next set, and the committee is selected (the base
fails with "Failed to select validators"). Still node-side: the `beef` key
fallback, rule 11, the six-hour epoch and the data pump.

Dev node notes: `CFG_PRESET=dev` with `APPEND_ARGS='--enable-offchain-indexing
true'` (and `--rpc-port`/`--port`/`--prometheus-port` for a second node);
epochs are 30 minutes aligned to the wall clock; `mmr_generateProof` takes
block numbers, and the leaf for block `b` is the one block `b` adds
(parent `b − 1`).

Status (2026-09-27): done. The soak ran on the node repo's
`local-environment` `local-env` stack: a local Cardano devnet with db-sync
and six nodes built from `kc-beefy-mip-alignment` (`earthly +node-image`,
`+toolkit-image`); nothing is mocked (user decision: no mock data; the `dev`
preset mocks the main-chain follower). It needed two fixes, now two commits
on `kc-beefy-mip-alignment` (`tytqkpmx`, `pzwqzunn`): the contract-compiler
image's `libssl-dev` pin and postgres `max_connections` (120 against six
nodes' pools of up to 37).

Final run, on the stack `just private-net-up` started: preview light client
`5a6a581f` (one-shot tx `ce471313`), bootstrapped at block 560 (sets 112 and
113); `bridge-verify-bootstrap` passed; 28 funded handovers (sets 113–140)
from real justifications, across a `change-federated-ops` removal of one
candidate on the devnet (`76e08ca4`): set 137 has four keys, one with two
seats, and its own justification (3 of 4 keys, 4 of 5 seats) was accepted.
Earlier runs: light client `2d0acfc0` (`31726abb`) on the same stack started
by hand, 27 handovers (sets 8–34) across the same change at set 31; and
`14fe24a5` on a `dev` node (mocked follower), two handovers.
Findings: overview.md "What the node must emit". On both local-env deploys
the third transaction (`committee-bridge-scripts`) failed: its coin selection
took the two one-shots and the collateral of the `simple-tx` the runbook
makes (`ce471313#0`, `#1`, `#2`), which the first two transactions spend;
`deploy --components committee-bridge-scripts` again landed it. Fixed after
the run: the deployer wallet never offers a profile's one-shots or collateral
to coin selection (`GuardedWallet`, `reservedRefs`).

## Tasks

### 1. Stack
Done (user decision 2026-09-27: a `just` recipe over the node repo's
local-env, no stack copied here): `just private-net-up [node] [ref]
[session_slots] [mc_epoch]` and `just private-net-down` run
`tests/private-net/local-env.sh`. Demo timing (user decision 2026-09-27):
1-minute sessions (10 slots) over a 60 s devnet epoch; the node refuses a
Cardano epoch that is not a whole multiple of the session. A
`change-federated-ops` reached the committee 3 min 36 s after it confirmed. It builds the
node and toolkit images of the ref when missing, exports the ref and the
contracts commit it pins to `.private-net/`, and runs `run:local-env` there.
Membership changes are real `change-federated-ops` transactions on the
devnet. Run end to end (up, down, up) on `kc-beefy-mip-alignment`
(`3.0.0-c2f414778991-arm64`): a block every slot, no `PoolTimedOut`, 136 of
400 postgres connections in use, sessions every 5 blocks with 4 of 5 seats
signing; `bridge-bootstrap` and `bridge-fetch-justification` against it. The
original plan follows.

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
reference and prints the bootstrap state for `deploy`'s env (phase 06
task 1: `deploy --components committee-bridge` reads it through
`Settings`).

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

## Review note carried from phase 01
- Rule 10 assumes the leaf appended in the first block of session N names
  N+1: `pallet_session` must run before `pallet_mmr` in `on_initialize`
  (Polkadot order). Confirmed on a local dev node (2026-09-27):
  `#[frame_support::runtime]` runs hooks in index order, and on
  `lglo/beefy-on-main` Mmr (22) runs before Session (30), so that leaf names
  N, the BEEFY mandatory block fails rule 10, and a session with only its
  mandatory justification stops the bridge (polkadot-fellows/runtimes#160).
  `kc-beefy-mip-alignment` moves Beefy, Mmr and BeefyMmrLeaf to 34–36.
