/**
 * RealmMap — the "world map" of districts. Each tile is a real feature dressed
 * up as a place in the Sakura Realm. Tiles below the player's level show a
 * flavour lock badge but remain fully navigable (we never gate real features).
 */

import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { DISTRICTS } from '../../lib/gamification'

interface RealmMapProps {
  level: number
}

export function RealmMap({ level }: RealmMapProps) {
  const navigate = useNavigate()

  return (
    <div className="rounded-suwappu-xl bg-white p-3 shadow-suwappu-1">
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="font-heading text-sm font-semibold text-suwappu-purple-deep">
          🗺️ Realm Map
        </span>
        <span className="text-[11px] text-suwappu-text-secondary">Explore the districts</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {DISTRICTS.map((d, i) => {
          const locked = level < d.unlockLevel
          return (
            <motion.button
              key={d.id}
              onClick={() => navigate(d.path)}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04 }}
              whileTap={{ scale: 0.97 }}
              className={`relative overflow-hidden rounded-suwappu-lg bg-gradient-to-br ${d.gradientFrom} ${d.gradientTo} p-3 text-left text-white shadow-suwappu-1`}
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-white/15" />
              <div className="relative flex items-start justify-between">
                <span className="text-2xl">{d.icon}</span>
                {locked && (
                  <span className="rounded-full bg-black/30 px-1.5 py-0.5 text-[9px] font-bold backdrop-blur-sm">
                    🔒 Lv {d.unlockLevel}
                  </span>
                )}
              </div>
              <p className="relative mt-2 font-heading text-sm font-bold leading-tight">{d.name}</p>
              <p className="relative text-[10px] text-white/80">{d.subtitle}</p>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
