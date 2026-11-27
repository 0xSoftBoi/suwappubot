A: db.ts withDbLock bounded try-lock + semaphore (LOCK_BUSY 503) - code present, live run pending
B: earnCreditChain.ts postExternalLeg tx insert+post + repair-on-existing - DONE
C: BankEarnService.ts guarded confirm (deposit+withdraw), undo requires confirmed reservation, hash only while pending (aborts pre-broadcast) - DONE
D: BankEarnService.ts auto-sweep uses availableBalance (row-locked) - DONE
E: BankTransferService.ts syncDeposit in-flight includes pending earn/credit ops - DONE
