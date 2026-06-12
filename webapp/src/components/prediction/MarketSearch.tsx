import { useState } from 'react'

const CATEGORIES = [
  'All',
  'Politics',
  'Sports',
  'Crypto',
  'Pop Culture',
  'Science',
  'Finance',
  'Tech',
]

interface MarketSearchProps {
  onSearch: (query: string) => void
  onCategoryChange: (category: string | undefined) => void
  activeCategory?: string
}

export function MarketSearch({ onSearch, onCategoryChange, activeCategory }: MarketSearchProps) {
  const [query, setQuery] = useState('')

  const handleSearch = (value: string) => {
    setQuery(value)
    onSearch(value)
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-suwappu-text-secondary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search markets..."
          className="w-full pl-10 pr-4 py-2.5 rounded-suwappu-lg border border-suwappu-sakura-mid/20 bg-white text-sm focus:outline-none focus:border-suwappu-magenta-mid transition-colors"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat || (cat === 'All' && !activeCategory)
          return (
            <button
              key={cat}
              onClick={() => onCategoryChange(cat === 'All' ? undefined : cat)}
              className={`px-3 py-1.5 text-xs font-heading font-semibold rounded-suwappu-pill whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-suwappu-gradient text-white shadow-suwappu-button'
                  : 'bg-white text-suwappu-text-secondary border border-suwappu-sakura-mid/20 hover:border-suwappu-magenta-mid'
              }`}
            >
              {cat}
            </button>
          )
        })}
      </div>
    </div>
  )
}
