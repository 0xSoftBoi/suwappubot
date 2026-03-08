import Navigation from '@/components/Navigation';
import HorizontalScroll from '@/components/HorizontalScroll';
import Hero from '@/components/Hero';
import Panel2HowItWorks from '@/components/Panel2HowItWorks';
import Panel3Features from '@/components/Panel3Features';
import PlatformDemos from '@/components/PlatformDemos';
import Panel5CTA from '@/components/Panel5CTA';

export default function HomePage() {
  return (
    <main>
      <Navigation />
      <HorizontalScroll>
        <Hero />
        <Panel2HowItWorks />
        <Panel3Features />
        <PlatformDemos />
        <Panel5CTA />
      </HorizontalScroll>
    </main>
  );
}
