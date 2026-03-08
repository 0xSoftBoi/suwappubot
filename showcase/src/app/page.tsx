import SakuraPetals from '@/components/SakuraPetals';
import Navigation from '@/components/Navigation';
import Hero from '@/components/Hero';
import ChainStrip from '@/components/ChainStrip';
import PoweredBy from '@/components/PoweredBy';
import WhyChat from '@/components/WhyChat';
import HowItWorks from '@/components/HowItWorks';
import Features from '@/components/Features';
import TrustSecurity from '@/components/TrustSecurity';
import Comparison from '@/components/Comparison';
import PlatformDemos from '@/components/PlatformDemos';
import FAQ from '@/components/FAQ';
import CTASection from '@/components/CTASection';
import Footer from '@/components/Footer';

export default function HomePage() {
  return (
    <main>
      <SakuraPetals count={8} />
      <Navigation />
      <Hero />
      <ChainStrip />
      <div className="section-divider max-w-4xl mx-auto" />
      <PoweredBy />
      <WhyChat />
      <div className="section-divider max-w-4xl mx-auto" />
      <HowItWorks />
      <Features />
      <div className="section-divider max-w-4xl mx-auto" />
      <TrustSecurity />
      <Comparison />
      <PlatformDemos />
      <div className="section-divider max-w-4xl mx-auto" />
      <FAQ />
      <CTASection />
      <Footer />
    </main>
  );
}
