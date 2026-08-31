'use client';

import { Scroll } from '@phosphor-icons/react';
import ComingOnline from '../components/ComingOnline';

export default function AuditPage() {
  return (
    <ComingOnline
      icon={<Scroll size={24} weight="duotone" />}
      title="Audit"
      lead="A rendered, exportable view of the tamper-evident, hash-chained audit log behind every admin action. This section is coming online as part of the enterprise dashboard parity work."
    />
  );
}
