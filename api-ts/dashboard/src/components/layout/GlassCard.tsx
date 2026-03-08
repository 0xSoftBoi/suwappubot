import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

interface GlassCardProps {
  children: ReactNode
  className?: string
}

export default function GlassCard({ children, className = '' }: GlassCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`bg-white/80 dark:bg-dark-surface/80 backdrop-blur-xl border border-suwappu-sakura-light/20 dark:border-dark-border rounded-suwappu-xl shadow-suwappu-2 ${className}`}
    >
      {children}
    </motion.div>
  )
}
