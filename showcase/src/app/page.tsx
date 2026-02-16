'use client'

import { Hero, Features, PlatformDemos, HowItWorks, CTA, SocialProof, FAQ, Footer, ComparisonChart } from '@/components/sections'
import { SakuraPetals, Navigation, Marquee } from '@/components/ui'

export default function ShowcasePage() {
  return (
    <main className="relative">
      {/* Floating Sakura Petals */}
      <SakuraPetals count={6} />

      {/* Navigation */}
      <Navigation />

      {/* Page Sections */}
      <Hero />

      <Marquee />

      <Features />

      <ComparisonChart />

      <PlatformDemos />

      <HowItWorks />

      <SocialProof />

      <FAQ />

      <CTA />

      <Footer />
    </main>
  )
}
