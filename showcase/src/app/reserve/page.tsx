import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import ReserveClient from './ReserveClient';

const TITLE = 'Reserve your Suwappu name | Suwappu';
const DESCRIPTION =
  'Claim your unique Suwappu account name before launch. Refer friends to climb the waitlist leaderboard and move up the line.';

export const metadata: Metadata = {
  title: 'Reserve your Suwappu name',
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
    <div className="summer-page docs-shell institutional-page">
      <SummerNav />
      <main id="main-content">
      <div className="summer-shell mkt-page">
        <ReserveClient />
      </div>
      </main>
      <SummerFooter />
    </div>
  );
}
