import type { Metadata } from 'next';
import { Dapp } from '@/components/dapp/Dapp';
import { DappProviders } from '@/components/dapp/Providers';

export const metadata: Metadata = {
  title: 'Primitives — Suwappu',
  description:
    'Interact with three immutable, oracle-free DeFi primitives on Base Sepolia: a time-locked bonding curve, a self-repaying vault, and a mutual credit network.',
};

export default function PrimitivesPage() {
  return (
    <DappProviders>
      <Dapp />
    </DappProviders>
  );
}
