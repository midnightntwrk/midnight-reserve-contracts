validator_json_indices:
    #!/bin/bash
    jq -r '.validators[] | "\(.title)"' plutus.json | nl -v0
