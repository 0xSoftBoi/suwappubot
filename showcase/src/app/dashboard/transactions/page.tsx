'use client';

import { ChartLine } from '@phosphor-icons/react';
import ComingOnline from '../components/ComingOnline';

export default function TransactionsPage() {
  return (
    <ComingOnline
      icon={<ChartLine size={24} weight="duotone" />}
      title="Transactions"
      lead="Filterable transaction monitoring with CSV export, across swaps, transfers, and approvals. This section is coming online as part of the enterprise dashboard parity work."
    />
  );
}
