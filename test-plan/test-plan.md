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
     
- [ ] \[Test\]  
- [ ] \[Test\]

Each phase includes expected-success and expected-failure scenarios to validate correctness and enforcement conditions.

# 

1. # Contract Deployment and Upgrade Tests {#contract-deployment-and-upgrade-tests}

I propose testing the contracts in the following phases:

1. **Initial Deployment**  
   

Validate that the governance contract suite can be properly deployed with a range of initial configurations.

* **Positive Tests**

  - [ ] Ensure that we can deploy the contracts themselves with a range of initial parameters  
  - [ ] Confirm deployment artifacts are published correctly.  
  - [ ] Verify UTxOs contain correct initial validator hashes and script states.  
          
* **Negative Tests**  
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

5. **Downgrade Logic upgrade**  
     
   Test reversion (downgrade) to a prior logic version.  
     
   - [ ] Starting from a successfully upgraded business logic UTxO, deploy the previous logic to the staging UTxO  
   - [ ] Confirm upgraded logic applies to the main UTxO, and old logic does not apply  
   - [ ] Confirm old logic applies to staging UTxO, and new logic does apply  
   - [ ] Promote the staging UTxO to active  
   - [ ] Confirm old logic applies to both  
           
6. **Add Mitigation Logic Script**

Introduce new safety or circuit-breaker logic to business logic UTxOs.

- [ ] Upgrade the protocol to introduce a new mitigation to one of the logic UTxOs  
      - [ ] Confirm the behavior is enforced  
              
7. **Attempt to remove Mitigation Logic Script**  
     
   Ensure that once a mitigation has been added to the logic scripts, any upgrade attempting to remove or bypass that mitigation is correctly rejected by the protocol.  
     
   - [ ] Build a transaction that attempts to remove the above mitigation via an upgrade  
   - [ ] Confirm the transaction is rejected  
           
8. **Add Mitigation Auth Script**  
   Introduce a mitigation at the authorization-script level (e.g., additional approval key, quorum change).  
     
   - [ ] Upgrade the protocol to introduce a new mitigation to the authorization scripts  
   - [ ] Confirm the behavior is enforced  
           
9. **Attempt to remove Mitigation Auth Script**  
   Verify that once a mitigation has been added to the authorization scripts, any upgrade attempting to weaken, remove, or circumvent that mitigation is rejected by the protocol.  
     
   - [ ] Build a transaction that attempts to remove the above mitigation via an upgrade  
   - [ ] Confirm the transaction is rejected

10. **Reserve ↔ IlliquidCirculationSupply Cross-Contract Interaction**  
    Verify that once a mitigation has been added to the authorization scripts, any upgrade attempting to weaken, remove, or circumvent that mitigation is rejected by the protocol.  
      
    - [ ] Build a transaction that attempts to remove the above mitigation via an upgrade  
    - [ ] Confirm the transaction is rejected

2. # Cross-Contract Interaction Tests {#cross-contract-interaction-tests}

     
1. **\[Test\]**   
   

\[brief description\]

- [ ] \[test\]

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
0f3e6204784ba3cd05800396205a390b1ecb3769996c126011433861f7524494  
council  
f26f7551fd1abd5ee67b9bc14de111b7c260a5015ae5552f3f0e50a5d9443db3  
tech\_auth\_threshold  
49ea787af8f953fd6d85706330e3fa22fe169885e72047786cd9ef24c56f0b9a  
council\_Threshold  
9dfef57f2d09bfc91155d5e0ae1513a4ac262f430d2de1746690386446688811