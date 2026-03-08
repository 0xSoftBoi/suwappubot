import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'

const links = [
  { to: '/', label: 'Overview', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { to: '/agents', label: 'Agents', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  { to: '/swaps', label: 'Swaps', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
  { to: '/webhooks', label: 'Webhooks', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { to: '/developer', label: 'Developer', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
]

export default function Sidebar() {
  return (
    <motion.aside
      initial={{ x: -260 }}
      animate={{ x: 0 }}
      className="w-64 shrink-0 bg-white dark:bg-dark-surface border-r border-suwappu-sakura-light/30 dark:border-dark-border flex flex-col"
    >
      <div className="p-6">
        <h1 className="text-xl font-heading font-bold bg-suwappu-gradient bg-clip-text text-transparent">
          Suwappu
        </h1>
        <p className="text-xs text-suwappu-text-secondary dark:text-gray-400 mt-1">Admin Dashboard</p>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-suwappu-md text-sm font-medium transition-all ${
                isActive
                  ? 'bg-suwappu-magenta/10 text-suwappu-magenta dark:bg-suwappu-magenta/20'
                  : 'text-suwappu-text-secondary dark:text-gray-400 hover:bg-suwappu-sakura-light/20 dark:hover:bg-dark-border/50'
              }`
            }
          >
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={link.icon} />
            </svg>
            {link.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-suwappu-sakura-light/20 dark:border-dark-border">
        <p className="text-xs text-suwappu-text-secondary dark:text-gray-500">v0.1.0</p>
      </div>
    </motion.aside>
  )
}
