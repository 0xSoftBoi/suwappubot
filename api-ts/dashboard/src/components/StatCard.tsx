import { motion } from 'framer-motion'

interface StatCardProps {
  label: string
  value: number | string
  subtitle?: string
  color?: 'magenta' | 'purple' | 'success' | 'warning' | 'error' | 'info'
}

const colorMap = {
  magenta: 'text-suwappu-magenta',
  purple: 'text-suwappu-purple',
  success: 'text-green-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
  info: 'text-blue-500',
}

export default function StatCard({ label, value, subtitle, color = 'magenta' }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white/80 dark:bg-dark-surface/80 backdrop-blur-xl border border-suwappu-sakura-light/20 dark:border-dark-border rounded-suwappu-xl p-5 shadow-suwappu-1"
    >
      <p className="text-sm text-suwappu-text-secondary dark:text-gray-400 font-medium">{label}</p>
      <p className={`text-3xl font-heading font-bold mt-1 ${colorMap[color]}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {subtitle && (
        <p className="text-xs text-suwappu-text-secondary dark:text-gray-500 mt-1">{subtitle}</p>
      )}
    </motion.div>
  )
}
