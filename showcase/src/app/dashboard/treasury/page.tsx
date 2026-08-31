'use client';

import { Bank } from '@phosphor-icons/react';
import ComingOnline from '../components/ComingOnline';

export default function TreasuryPage() {
  return (
    <ComingOnline
      icon={<Bank size={24} weight="duotone" />}
      title="Treasury"
      lead="Multi-chain balance and historical value across every wallet your organisation controls, in one view. This section is coming online as part of the enterprise dashboard parity work."
    />
  );
}
