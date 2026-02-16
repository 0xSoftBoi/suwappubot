'use client'

import { useRef } from 'react'
import { motion, useInView } from 'framer-motion'
import { comparisonRow } from '@/lib/animations'

const columns = ['Suwappu', 'CEXs', 'DEX Aggregators'] as const

type CellValue = 'yes' | 'no' | 'partial' | string

interface Row {
  label: string
  values: [CellValue, CellValue, CellValue]
}

const rows: Row[] = [
  { label: 'Non-Custodial', values: ['yes', 'no', 'yes'] },
  { label: 'Cross-Chain', values: ['yes', 'partial', 'partial'] },
  { label: 'Low Fees', values: ['0.3%', '0.1–0.5%', '0.3–1%'] },
  { label: 'Speed', values: ['< 1s quotes', 'Instant', '5–30s'] },
  { label: 'Chains', values: ['7+', 'Varies', '3–5'] },
  { label: 'Chat Interface', values: ['yes', 'no', 'no'] },
  { label: 'AI Agents', values: ['yes', 'no', 'no'] },
  { label: 'No KYC Required', values: ['yes', 'no', 'yes'] },
]

function CellContent({ value }: { value: CellValue }) {
  if (value === 'yes') {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-600">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )
  }
  if (value === 'no') {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-400">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    )
  }
  if (value === 'partial') {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-yellow-100 text-yellow-600">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14" />
        </svg>
      </span>
    )
  }
  return <span className="font-body text-sm text-suwappu-text-secondary">{value}</span>
}

export default function ComparisonChart() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section className="py-24 px-6 bg-suwappu-blush" id="comparison">
      <div className="max-w-4xl mx-auto" ref={ref}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="inline-block px-4 py-1 rounded-full bg-suwappu-sakura-light/50 text-suwappu-magenta text-sm font-medium mb-4">
            Compare
          </span>
          <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold text-suwappu-text mb-4">
            Why Suwappu?
          </h2>
          <p className="font-body text-lg text-suwappu-text-secondary max-w-xl mx-auto">
            See how we stack up against centralized exchanges and other DEX aggregators.
          </p>
        </motion.div>

        {/* Table */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="overflow-x-auto -mx-6 px-6"
        >
          <div className="min-w-[540px]">
            {/* Column Headers */}
            <div className="grid grid-cols-4 gap-3 mb-2">
              <div /> {/* Empty cell for row labels */}
              {columns.map((col, i) => (
                <div
                  key={col}
                  className={`text-center py-3 px-2 rounded-t-xl font-heading font-semibold text-sm ${
                    i === 0
                      ? 'bg-suwappu-gradient text-white'
                      : 'bg-white text-suwappu-text-secondary'
                  }`}
                >
                  {col}
                </div>
              ))}
            </div>

            {/* Rows */}
            {rows.map((row, rowIndex) => (
              <motion.div
                key={row.label}
                variants={comparisonRow}
                initial="hidden"
                animate={isInView ? 'visible' : 'hidden'}
                custom={rowIndex}
                className={`grid grid-cols-4 gap-3 ${
                  rowIndex % 2 === 0 ? 'bg-white' : 'bg-suwappu-surface'
                } rounded-lg`}
              >
                {/* Row Label */}
                <div className="py-3 px-4 font-heading text-sm font-medium text-suwappu-text flex items-center">
                  {row.label}
                </div>
                {/* Values */}
                {row.values.map((val, colIndex) => (
                  <div
                    key={`${row.label}-${colIndex}`}
                    className={`py-3 px-2 flex items-center justify-center ${
                      colIndex === 0 ? 'border-l-2 border-suwappu-magenta/20' : ''
                    }`}
                  >
                    <CellContent value={val} />
                  </div>
                ))}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
