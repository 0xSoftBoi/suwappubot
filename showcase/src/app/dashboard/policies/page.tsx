'use client';

import { ListChecks } from '@phosphor-icons/react';
import ComingOnline from '../components/ComingOnline';

export default function PoliciesPage() {
  return (
    <ComingOnline
      icon={<ListChecks size={24} weight="duotone" />}
      title="Policies"
      lead="Quorum approval workflows and spending policy rules — limits, velocity, allowlists — for transfers and withdrawals. This section is coming online as part of the enterprise dashboard parity work."
    />
  );
}
