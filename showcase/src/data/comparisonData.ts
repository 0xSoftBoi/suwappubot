export interface CompareRow {
  label: string;
  suwappu: boolean | string;
  cex: boolean | 'partial' | string;
  dex: boolean | 'partial' | string;
}

export const COMPARE_ROWS: CompareRow[] = [
  { label: 'Non-custodial', suwappu: true, cex: false, dex: true },
  { label: 'Cross-chain', suwappu: true, cex: 'partial' as const, dex: 'partial' as const },
  { label: 'Fee', suwappu: '0.3%', cex: '0.1\u20130.5%', dex: '0.3\u20131%' },
  { label: 'Quote speed', suwappu: '< 1s', cex: 'Instant', dex: '5\u201330s' },
  { label: 'Chains', suwappu: '15', cex: 'Varies', dex: '3\u20135' },
  { label: 'MEV protection', suwappu: true, cex: false, dex: 'partial' as const },
  { label: 'Chat interface', suwappu: true, cex: false, dex: false },
  { label: 'No KYC', suwappu: true, cex: false, dex: true },
];
