import Navigation from '@/components/Navigation';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navigation />
      {children}
    </>
  );
}
