build-validators:
    @mkdir -p src/utils/
    @aiken build -t silent # verbose
    @aiken build -t verbose -o plutus-trace.json
    @bunx @blaze-cardano/blueprint plutus.json plutus-trace.json -o ./src/utils/contracts.ts
