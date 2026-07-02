import { redirect } from 'next/navigation';

// /for-agents has been superseded by the fuller /agents landing page.
// Keep this route alive (old links, bookmarks, backlinks) but send everyone
// to the canonical page instead of maintaining two overlapping pages.
export default function ForAgentsPage() {
  redirect('/agents');
}
