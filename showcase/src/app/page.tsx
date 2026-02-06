'use client'

import { Hero, Features, PlatformDemos, HowItWorks, CTA, SocialProof, FAQ, Footer } from '@/components/sections'
import { SakuraPetals, Navigation } from '@/components/ui'

export default function ShowcasePage() {
  return (
    <main className="relative">
      {/* Floating Sakura Petals */}
      <SakuraPetals count={12} />

      {/* Navigation */}
      <Navigation />

      {/* Page Sections */}
      <Hero />

      <div className="section-divider" />

      <Features />

      <div className="section-divider" />

      <SocialProof />

      <div className="section-divider" />

      <PlatformDemos />

      <div className="section-divider" />

      <HowItWorks />

      <div className="section-divider" />

      <FAQ />

      <CTA />

      <Footer />
    </main>
  )
}
