import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { Reveal } from '@/components/v3';
import '../sales-v3.css';
import styles from './brand.module.css';

export const metadata: Metadata = {
  title: 'Brand kit',
  description: 'Suwappu logo files, brand colours and typefaces, with short usage guidance for press and partners.',
};

// Real files already served from public/. No invented assets.
const ASSETS = [
  { file: '/logo.svg', name: 'Logo mark', note: 'SVG, 1000 x 1000', tone: 'light' },
  { file: '/favicon.svg', name: 'Favicon', note: 'SVG', tone: 'light' },
  { file: '/social-card.svg', name: 'Social card', note: 'SVG, link-preview artwork', tone: 'dark' },
];

// Values from the design tokens in src/app/globals.css.
const COLOURS = [
  { name: 'Persimmon', hex: '#E58D2B', token: '--sw-accent', ink: '#17324A' },
  { name: 'Persimmon deep', hex: '#C9731D', token: '--sw-accent-deep', ink: '#0B1220' },
  { name: 'Ink', hex: '#17324A', token: '--sw-ink', ink: '#FFFFFF' },
  { name: 'Cosmic', hex: '#0B1220', token: '--sw-cosmic-1', ink: '#E8EEF6' },
  { name: 'Cosmic ink', hex: '#E8EEF6', token: '--sw-cosmic-ink', ink: '#0B1220' },
];

const TYPE = [
  { name: 'Newsreader', role: 'Display headlines (serif)' },
  { name: 'Archivo', role: 'Body and interface text' },
  { name: 'JetBrains Mono', role: 'Labels, numerals and code' },
];

const DO = [
  'Use the logo files as supplied, on a clear background with room around the mark.',
  'Write the name as Suwappu in prose and suwappu in the wordmark.',
  'Use the persimmon colour for one primary action or accent, not whole pages.',
];
const DONT = [
  'Do not recolour, stretch, rotate or add effects to the logo.',
  'Do not imply endorsement, partnership or a customer relationship we have not announced.',
  'Do not redraw the mark or combine it with another logo into a new one.',
];

export default function BrandPage() {
  return (
    <div className="summer-page docs-shell institutional-page v3-tone-light">
      <SummerNav />
      <main id="main-content">
        <div className="summer-shell mkt-page">
          <header className="mkt-hero mkt-hero--center">
            <h1>Brand kit</h1>
            <p className="mkt-hero__lead">Logo files, colours and type, for press and partners.</p>
          </header>

          <Reveal as="section" className={styles.block}>
            <h2 id="brand-logos" className="mkt-h2">Logo files</h2>
            <ul className={styles.assets}>
              {ASSETS.map((a) => (
                <li key={a.file} className={styles.asset}>
                  <div className={`${styles.stage} ${a.tone === 'dark' ? styles.stageDark : ''}`}>
                    <img src={a.file} alt={`${a.name} preview`} loading="lazy" />
                  </div>
                  <div className={styles.assetMeta}>
                    <b>{a.name}</b>
                    <span>{a.note}</span>
                    <a href={a.file} download>Download</a>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal as="section" className={styles.block}>
            <h2 id="brand-colour" className="mkt-h2">Colour</h2>
            <ul className={styles.swatches}>
              {COLOURS.map((c) => (
                <li key={c.token} className={styles.swatch} style={{ background: c.hex, color: c.ink }}>
                  <b>{c.name}</b>
                  <span>{c.hex}</span>
                  <code>{c.token}</code>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal as="section" className={styles.block}>
            <h2 id="brand-type" className="mkt-h2">Type</h2>
            <dl className={styles.type}>
              {TYPE.map((t) => (
                <div key={t.name}><dt>{t.name}</dt><dd>{t.role}</dd></div>
              ))}
            </dl>
          </Reveal>

          <Reveal as="section" className={styles.block}>
            <h2 id="brand-use" className="mkt-h2">Usage</h2>
            <div className={styles.rules}>
              <div>
                <h3>Do</h3>
                <ul>{DO.map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
              <div>
                <h3>Do not</h3>
                <ul>{DONT.map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
            </div>
            <p className={styles.contact}>Press or partner question? <a href="/contact">Get in touch</a>.</p>
          </Reveal>
        </div>
      </main>
      <SummerFooter />
    </div>
  );
}
