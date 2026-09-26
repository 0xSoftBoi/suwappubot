import SummerNav from '@/components/SummerNav';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SummerNav />
      {children}
    </>
  );
}
