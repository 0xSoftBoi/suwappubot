'use client';

import { ClipboardText } from '@phosphor-icons/react';
import ComingOnline from '../components/ComingOnline';

export default function SecurityPage() {
  return (
    <ComingOnline
      icon={<ClipboardText size={24} weight="duotone" />}
      title="Security"
      lead="One incident screen for key/session activity, risk scoring, and alerting — a Fireblocks-style Security Center for your organisation. This section is coming online as part of the enterprise dashboard parity work."
    />
  );
}
