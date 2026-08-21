import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import ReserveClient from './ReserveClient';

const TITLE = 'Reserve your Suwappu name | Suwappu';
const DESCRIPTION =
  'Claim your unique Suwappu account name before launch. Refer friends to climb the waitlist leaderboard and move up the line.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    url: 'https://suwappu.bot/reserve',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function ReservePage() {
  return (
    <main id="main-content" className="summer-page docs-shell institutional-page">
      <Navigation />
      <div className="summer-shell mkt-page">
        <ReserveClient />
      </div>
      <SummerFooter />
    </main>
  );
}
