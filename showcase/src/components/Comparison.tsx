'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { COMPARE_ROWS } from '@/data/comparisonData';
import { stagger, staggerChild, viewportOnce } from '@/lib/animations';

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <svg className="w-5 h-5 text-suwappu-success mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;
  if (value === false) return <svg className="w-4 h-4 text-suwappu-dark-text-muted/50 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
  if (value === 'partial') return <span className="text-xs font-medium text-suwappu-warning">Partial</span>;
  return <span className="text-sm font-medium">{value}</span>;
}

export default function Comparison() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, viewportOnce);

  return (
    <section id="compare" className="py-28 px-6">
      <div className="max-w-3xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p variants={staggerChild} className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
            Compare
          </motion.p>
          <motion.h2 variants={staggerChild} className="font-heading font-bold text-3xl md:text-4xl text-center mb-4">
            How it stacks up
          </motion.h2>
          <motion.p variants={staggerChild} className="text-center text-suwappu-dark-text-secondary mb-12 text-sm">
            Honest breakdown. Decide for yourself.
          </motion.p>

          <motion.div variants={staggerChild} className="glass-card rounded-2xl overflow-hidden shadow-suwappu-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 bg-suwappu-dark-surface-elevated">
                    <th className="text-left py-4 px-5 font-heading font-medium text-suwappu-dark-text-muted text-xs" />
                    <th className="py-4 px-4 text-center font-heading font-bold text-sm bg-suwappu-gradient bg-clip-text text-transparent">Suwappu</th>
                    <th className="py-4 px-4 text-center font-heading font-medium text-xs text-suwappu-dark-text-secondary">CEXs</th>
                    <th className="py-4 px-4 text-center font-heading font-medium text-xs text-suwappu-dark-text-secondary">DEX Agg.</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row, i) => (
                    <tr key={row.label} className={`${i < COMPARE_ROWS.length - 1 ? 'border-b border-white/5' : ''}`}>
                      <td className="py-3.5 px-5 font-medium text-sm text-suwappu-dark-text">{row.label}</td>
                      <td className="py-3.5 px-4 text-center bg-suwappu-magenta/[0.04]"><Cell value={row.suwappu} /></td>
                      <td className="py-3.5 px-4 text-center"><Cell value={row.cex} /></td>
                      <td className="py-3.5 px-4 text-center"><Cell value={row.dex} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
