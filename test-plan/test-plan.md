# Midnight Governance Contracts Testing Plan

This document outlines a checklist of positive and negative exercises to physically confirm the correct behavior and deployment of the upgradable smart contracts intended to be used for the Midnight blockchain.

# 

# Test Structure Overview

Testing is divided into sequential phases to mirror the contract lifecycle and governance flows:

1. [**Core Contract Deployment and Upgrade Tests**](#contract-deployment-and-upgrade-tests)

- [ ] Initial Deployment  
- [ ] Authorization Logic  
- [ ] Abort Logic Upgrade  
- [ ] Successful Logic Upgrade  
- [ ] Downgrade Logic Upgrade  
- [ ] Mitigation Logic Script Addition  
- [ ] Mitigation Logic Script Removal Attempt  
- [ ] Mitigation Authorization Script Addition  
- [ ] Mitigation Authorization Script Removal Attempt  
        
2. [**Cross-Contract Interaction Tests**](#cross-contract-interaction-tests)  
     
- [ ] Reserve \<-\> IlliquidCirculationSupply Cross-Contract Interaction

Each phase includes expected-success and expected-failure scenarios to validate correctness and enforcement conditions.

# 

1. # Contract Deployment and Upgrade Tests {#contract-deployment-and-upgrade-tests}

I propose testing the contracts in the following phases:

1. **Initial Deployment**  
   

Validate that the governance contract suite can be properly deployed with a range of initial configurations.

- [ ] Ensure that we can deploy the contracts themselves with a range of initial parameters  
      - [ ] Confirm deployment artifacts are published correctly.  
      - [ ] Verify UTxOs contain correct initial validator hashes and script states.  
              
* **Negative**  
  - [ ] Ensure transactions with invalid parties fail  
  - [ ] Attempt invalid parameter ranges (out-of-bounds thresholds, empty keys, malformed time locks).  
  - [ ] Confirm all invalid configurations are rejected  
          
2. **Authorization Logic Validation**  
     
   Exercise a variety of authorization script topologies to confirm enforcement behavior.  
     
   - [ ] Exercise various permutations of the authorization scripts:  
         - [ ] A single signature  
         - [ ] An M-of-N threshold signature  
         - [ ] A staged hand-off signature using time locks  
         - [ ] A 3-deep tree of different overlapping key sets  
         - [ ] Weighted threshold signatures using repeated keys  
         - [ ] 0-of-N threshold signatures are valid. Like in the case of 0 council, ½ tech auth 

   

   **Outcome validation**

   

- [ ] Confirm valid combinations authorize correctly  
- [ ] Confirm non-qualifying combinations and expired/invalid time-locked paths fail consistently  
        
3. **Abort Logic upgrade**  
     
   Validate that business logic can be intentionally replaced with "always fails" validators to deactivate a staging UTxO.  
     
   - [ ] Starting from a deployment with permissive settings, upgrade each business logic staging UTxO to an always fails validator  
   - [ ] Confirm main logic still applies, and new logic does not apply except to the staging UTxO  
   - [ ] Revert the staging UTxO to the previous settings  
   - [ ] Confirm main logic still applies to both main and staging

   

4. **Successful Logic upgrade**  
     
   Validate the upgrade to a fully new version of business logic.  
     
   - [ ] Starting from a deployment with permissive settings, upgrade each business logic staging UTxO to a new set of keys  
   - [ ] Confirm new logic applies to staging UTxO  
   - [ ] Promote the staging UTxO to active  
   - [ ] Confirm new logic applies to main UTxO   
   - [ ] Confirm staging and main NFTs can not leave the two stage contract, can not accrue other tokens, and must maintain the same datum structure.

5. **Downgrade Logic upgrade**  
   	  
   Test reversion (downgrade) to a prior logic version.  
     
   - [ ] Starting from a successfully upgraded business logic UTxO, deploy the previous logic to the staging UTxO  
   - [ ] Confirm upgraded logic applies to the main UTxO, and old logic does not apply  
   - [ ] Confirm old logic applies to staging UTxO, and new logic does apply  
   - [ ] Promote the staging UTxO to active  
   - [ ] Confirm old logic applies to both  
   - [ ] Confirm staging and main NFTs can not leave the two stage contract, can not accrue other tokens, and must maintain the same datum structure.

   

   

6. **Repeat 2-5 with Governance Auth Upgrade**

   

7. **Add Mitigation Logic Script**

Introduce new safety or circuit-breaker logic to business logic UTxOs.

- [ ] Upgrade the protocol to introduce a new mitigation to one of the logic UTxOs  
      - [ ] Confirm the behavior is enforced  
              
8. **Attempt to remove Mitigation Logic Script**  
     
   Ensure that once a mitigation has been added to the logic scripts, any upgrade attempting to remove or bypass that mitigation is correctly rejected by the protocol.  
     
   - [ ] Build a transaction that attempts to remove the above mitigation via an upgrade  
   - [ ] Confirm the transaction is rejected  
           
9. **Add Mitigation Auth Script**  
   Introduce a mitigation at the authorization-script level (e.g., additional approval key, quorum change).  
     
   - [ ] Upgrade the protocol to introduce a new mitigation to the authorization scripts  
   - [ ] Confirm the behavior is enforced  
           
10. **Attempt to remove Mitigation Auth Script**  
    Verify that once a mitigation has been added to the authorization scripts, any upgrade attempting to weaken, remove, or circumvent that mitigation is rejected by the protocol.  
      
    - [ ] Build a transaction that attempts to remove the above mitigation via an upgrade  
    - [ ] Confirm the transaction is rejected

11. **Reserve ↔ IlliquidCirculationSupply Cross-Contract Interaction**  
    Verify logic merge script that both ics and reserve share.  
      
    - [ ] Verify utxos can be merged into both reserve and ics  
    - [ ] Verify Night and ada can never be taken only added to ics and reserve  
    - [ ] Verify forever NFT can not be moved. (Intentional)

2. # Cross-Contract Interaction Tests {#cross-contract-interaction-tests}

   

**Reserve \<-\> IlliquidCirculationSupply Cross-Contract Interaction**

Validate that a staged contract can be tested against test counterpart contracts and test tokens (via a test entry script), and then be promoted to main without further edits, while correctly switching behavior on the main track (e.g., releasing real cNIGHT to the real ICS).

- [ ] Create test entry scripts  
      - [ ] Prepare test data and test tokens  
      - [ ] Deploy a staged Reserve that can be tested and later promoted without edits  
      - [ ] Deploy a test ICS contract (not staged) for the staging-phase interaction  
      - [ ] Execute staged Reserve \-\> test ICS timed release  
      - [ ] Confirm staging isolation  
      - [ ] Promote staged Reserve to main without modification  
      - [ ] Execute main Reserve to real ICS release  
      - [ ] Confirm outputs are sent to the correct destination with expected value/datum and that state transitions are correct.  
              
* **Negative**   
  - [ ] Attempt staged Reserve to main ICS (or staged Reserve releasing production tokens). Confirm the transaction is rejected.  
  - [ ] Attempt main Reserve to test ICS. Confirm the transaction is rejected.  
  - [ ] Attempt to override or bypass destination-selection logic. Confirm the transaction is rejected.  
  - [ ] Clean up test data using the test entry script cleanup path (preferred) and confirm test UTxOs/artifacts are removed.  
        

**Threshold contract interactions**  
	Verify Threshold contracts updates affect all contracts that utilize that threshold state

- [ ] Main gov auth threshold should affect all two stage upgrade contracts on promoting to main from staging  
      - [ ] Staging gov auth threshold should affect all two stage upgrade contracts on changes made to staging  
      - [ ] Council update member threshold should affect only changes to council members  
      - [ ] tech-auth update member threshold should affect only changes to tech-auth members  
      - [ ] Federated ops update member threshold should affect only changes to federated ops members  
      - [ ] Terms & Cs threshold should affect only changes to Terms & Cs state changes  
      - [ ] A threshold of 0/1 allows for 0 signers

# Test Execution Plan

The above tests will be implemented via a command line interface testing suite. The CLI will:

* Prompt the user for relevant inputs (wallet address, parameters, etc.)  
* Alternatively read these prompts from a file / save prompts to a file, for reproducibility  
* Build transaction hashes that can then be signed and submitted by the user  
* Check what we can by querying the chain, and prompt the user for things to manually check for correctness  
* Allow isolating each step, or running them as an end to end test plan

# Transaction samples

Tests for example transactions using emulator can be found in the folder tests https://github.com/midnightntwrk/midnight-reserve-contracts/tree/upgradable-reserve

**Deploy transactions**  
tech\_auth  
61966981d477cf9717166fbe0b4387975e57066915041d7ee5519f23623ee7fa  
council  
6875869ff2f99d1fc943597c3dc23ff977eb7d19baf1911440eed3d6e2d9401f  
tech\_auth\_threshold  
79eb43aeb0243ba1ba8f28310fd73122f4bfe014be6fc8c23ab631b8a777e8ea  
council\_Threshold  
3a4478cc657f5c953ab9ec7c3c1a6da1eeb4bef6eb5781ef23e7b247d31c0346

I have a series of deploy, change auth for council and tech-auth, update staging, promote staging, and other transactions under addr\_test1qpvenhxereqm8exzhgphagas8kuguwa9vev4zc086ulg275tacf8lywukau5xvyy2z9dt6ttul4487htpgjruq0rynhsuhvxyn

Staging update: 04c62f886140a0f1058569c04e00c2d68e14d6266506c867950273696868e027  
Change council: fc7dc608a51b7a8053191579bc2442c3f6a21a7090397e67ac80d3fdc527b695  
Change council with weighted signer: 189894cedbe2407617a950f650500aa56fbe00072f5cf0023da6a8e8c162940c