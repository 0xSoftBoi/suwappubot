export default function DocsBreadcrumb({ section, page }: {
  section: { id: string; title: string };
  page: { title: string };
}) {
  return (
    <nav className="doc-breadcrumb">
      <a href="/">Home</a>
      <span className="doc-breadcrumb__sep">/</span>
      <a href="/docs">Docs</a>
      <span className="doc-breadcrumb__sep">/</span>
      <a href={`/docs#${section.id}`}>{section.title}</a>
      <span className="doc-breadcrumb__sep">/</span>
      <span>{page.title}</span>
    </nav>
  );
}
