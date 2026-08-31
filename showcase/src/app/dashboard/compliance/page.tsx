'use client';

import { ShieldCheck } from '@phosphor-icons/react';
import ComingOnline from '../components/ComingOnline';

export default function CompliancePage() {
  return (
    <ComingOnline
      icon={<ShieldCheck size={24} weight="duotone" />}
      title="Compliance"
      lead="KYT/screening surface for the allowlist, blocklist, and OFAC checks already enforced on swaps and withdrawals. This section is coming online as part of the enterprise dashboard parity work."
    />
  );
}
