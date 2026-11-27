# neobank verify-d fix status
1. DONE: BankApprovalService org lock now uses withDbLock (key org-xfer:<org>); rolling 24h counts all transfer types except fx/earn. No other blocking pg_advisory_lock( outside db.ts/jobs.ts (rest are xact locks / jobs try-lock).
   Spend-path decisions: cards (user-owned, org tag only; not org-account spend), earn/fx/remittance (owner-scoped routes, user/agent owner only; org accounts unreachable), treasury sweep (role-gated treasury.manage, moves to own earn vault, not an outflow), bills (performOrgTransfer), payroll (payroll.run + approval action).
