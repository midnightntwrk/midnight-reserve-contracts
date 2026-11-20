# Multisig

N-of-M multisig authorization for the governance validators. `script.ak` rebuilds
a Cardano native script from the on-chain `Multisig` datum and the configured
threshold, then requires the transaction to mint under the resulting policy — the
native script's own signature check is what enforces the threshold.

## Minting as a script execution mechanism

It is known that using a minting policy to execute the native script
produces tokens with no purpose beyond the minting event and leaves those 
tokens to be paid into some UTxO. There is a possibility of executing the 
scripts as stake credential registrations (with matching de-registrations
in the same transaction) instead, or as "guarding" once the Dijkstra era ships.

Alternatives are acknowledged and we do not intend to change the mechanism. Multisig
operations are governance actions and therefore very rare, so the resulting UTxO
pollution is negligible, and minting remains the simplest execution path under the
current ledger rules.

