'use client';

import Navigation from '@/components/Navigation';
import Overlay from '@/components/Overlay';
import StructuredData from '@/components/StructuredData';
import Analytics from '@/components/Analytics';

export default function Home() {
  return (
    <>
      <StructuredData />
      <Analytics />
      <Navigation />
      <Overlay />
    </>
  );
}
