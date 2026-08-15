import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin | Suwappu',
  robots: { index: false, follow: false },
};

/**
 * Admin shell: strips public nav/footer and forces a dark surface.
 * Nested layouts must not re-export <html>/<body> in the App Router;
 * the root layout owns those. We apply the dark override via an inline
 * style on a wrapping div instead.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-theme="dark"
      style={{
        minHeight: '100vh',
        background: '#0b111a',
        color: '#e2ecf4',
        // Pull the layout out from under the root body styles.
        position: 'relative',
        zIndex: 0,
      }}
    >
      {children}
    </div>
  );
}
