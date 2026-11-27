# Neobank review1b (core / earn / credit) fix status

1. DONE - holds.ts (assertHoldCovers, 'pending-transfer' hold provider, assertAvailable validates consumesHold); BankTransferService.ts insertTransferGuarded (dup-check, then assertAvailable under source row lock, then insert). No route forwards consumesHold (grep routes/ empty).
2. NOT STARTED
3. NOT STARTED
4. NOT STARTED
5. NOT STARTED
6. NOT STARTED
7. DONE - chain.ts rpc({noRetry}), evmBroadcast/solBroadcast: all errors ambiguous, "already known" = accepted.
8. DONE - BankTransferService.ts failAndReverse(noBroadcast) + finalizeTransfer requireNoHash re-check under row lock; BankFxService.ts claim token on persist/guard.
9. NOT STARTED
10. NOT STARTED
11. NOT STARTED
12. NOT STARTED
13. NOT STARTED
14. NOT STARTED
15. NOT STARTED
16. NOT STARTED

Debit coverage (ledger debits of user accounts): transfer/same-wallet/FX submit reserve -> insertTransferGuarded (assertAvailable); escrow funding -> assertAvailable (BankEscrowService:321); agent-pay -> assertAvailable (BankAgentPayService:175) and consumes own hold; earnCreditChain:324 -> assertAvailable (:340). Exempt/uncovered: BankCreditService settleExternalOp 'out' (on-chain repay; only assertSpendable), card settlement debits external only, clearing/fx system debits (internal legs).
