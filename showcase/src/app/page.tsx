'use client';

import dynamic from 'next/dynamic';
import { PlayProvider } from '@/contexts/Play';
import Overlay from '@/components/Overlay';
import SmoothScroll from '@/components/SmoothScroll';
import StructuredData from '@/components/StructuredData';
import Analytics from '@/components/Analytics';

const Scene3D = dynamic(() => import('@/components/Scene3D'), { ssr: false });

export default function Home() {
  return (
    <PlayProvider>
      <SmoothScroll>
        <StructuredData />
        <Analytics />
        <Scene3D />
        <Overlay />
      </SmoothScroll>
    </PlayProvider>
  );
}
