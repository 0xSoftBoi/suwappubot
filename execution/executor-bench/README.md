# Executor Gas Baseline

Research-only Foundry harness for measuring the overhead of a generic Suwappu route executor before introducing specialization or assembly.

## Baseline semantics

`BaselineExecutor` executes a bounded array of calls and then enforces a final token-balance minimum. A route is successful only when every external call succeeds **and** the final economic postcondition is met.

The benchmark scenarios use storage-free mock venue calls so the report isolates executor/call/calldata overhead rather than primarily measuring mock storage writes.

## Run

```sh
forge fmt --check
forge build --sizes
forge test -vv --gas-report
```

CI stores the gas report as the `executor-gas-report` artifact.

## Admission rule for specialization

Do not add assembly merely to reduce an isolated opcode count. A specialized executor must:

1. be semantically differential-tested against this baseline;
2. preserve external-call failure propagation and final economic postconditions;
3. materially reduce **total route** gas/calldata cost on representative one-leg and multi-leg fixtures;
4. improve expected realized route EV after accounting for the larger audit/failure surface.

Until the first observed CI artifact exists, there is no verified baseline gas number.
