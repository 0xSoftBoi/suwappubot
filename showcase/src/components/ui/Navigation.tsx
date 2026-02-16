'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion'

const navLinks = [
  { href: '#features', label: 'Features', section: 'features' },
  { href: '#demos', label: 'Demos', section: 'demos' },
  { href: '#how-it-works', label: 'How It Works', section: 'how-it-works' },
]

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false)
  const [activeSection, setActiveSection] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)

  const { scrollYProgress } = useScroll()
  const progressWidth = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])

  // Scroll-aware background
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Active section tracking via IntersectionObserver
  useEffect(() => {
    const sectionIds = navLinks.map((l) => l.section)
    const observers: IntersectionObserver[] = []

    sectionIds.forEach((id) => {
      const el = document.getElementById(id)
      if (!el) return
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(id)
        },
        { rootMargin: '-40% 0px -55% 0px' }
      )
      observer.observe(el)
      observers.push(observer)
    })

    return () => observers.forEach((o) => o.disconnect())
  }, [])

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  return (
    <>
      {/* Scroll progress bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-[2px] bg-suwappu-gradient z-[60] origin-left"
        style={{ scaleX: scrollYProgress }}
      />

      <nav
        className={`fixed top-[2px] left-0 right-0 z-50 px-6 py-4 transition-all duration-300 ${
          scrolled ? 'glass border-b border-suwappu-sakura-mid/30' : 'bg-transparent'
        }`}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          {/* Logo */}
          <a href="/" className="flex items-center gap-2">
            <span className="font-heading text-2xl font-bold gradient-text">Suwappu</span>
          </a>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <a
                key={link.section}
                href={link.href}
                className={`relative font-heading text-sm font-medium transition-colors ${
                  activeSection === link.section
                    ? 'text-suwappu-magenta'
                    : 'text-suwappu-text hover:text-suwappu-magenta'
                }`}
              >
                {link.label}
                {activeSection === link.section && (
                  <motion.span
                    layoutId="nav-dot"
                    className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-suwappu-magenta"
                  />
                )}
              </a>
            ))}
            <a
              href="https://t.me/SuwappuBot"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-suwappu-pill bg-suwappu-gradient text-white font-heading font-medium text-sm shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
            >
              Try Now
            </a>
          </div>

          {/* Mobile hamburger / X */}
          <button
            className="md:hidden p-2 rounded-lg glass relative z-50"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            <svg className="w-6 h-6 text-suwappu-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <motion.path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                animate={mobileOpen ? { d: 'M6 18L18 6' } : { d: 'M4 6h16' }}
                transition={{ duration: 0.2 }}
              />
              <motion.path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                animate={mobileOpen ? { opacity: 0 } : { opacity: 1, d: 'M4 12h16' }}
                transition={{ duration: 0.2 }}
              />
              <motion.path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                animate={mobileOpen ? { d: 'M6 6l12 12' } : { d: 'M4 18h16' }}
                transition={{ duration: 0.2 }}
              />
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile menu drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Overlay */}
            <motion.div
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeMobile}
            />

            {/* Drawer */}
            <motion.div
              className="fixed top-0 right-0 bottom-0 w-72 z-50 md:hidden glass-card pt-24 px-6 pb-8 flex flex-col"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
            >
              <div className="flex flex-col gap-4">
                {navLinks.map((link) => (
                  <a
                    key={link.section}
                    href={link.href}
                    onClick={closeMobile}
                    className={`font-heading text-lg font-medium py-2 transition-colors ${
                      activeSection === link.section
                        ? 'text-suwappu-magenta'
                        : 'text-suwappu-text hover:text-suwappu-magenta'
                    }`}
                  >
                    {link.label}
                  </a>
                ))}
              </div>

              <div className="mt-8">
                <a
                  href="https://t.me/SuwappuBot"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={closeMobile}
                  className="block text-center px-6 py-3 rounded-suwappu-pill bg-suwappu-gradient text-white font-heading font-medium text-sm shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
                >
                  Try Now
                </a>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
