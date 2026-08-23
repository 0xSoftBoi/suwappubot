import changelog from '../../api-changelog.json'

export const API_CHANGELOG = changelog

function xmlEscape(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;')
}

export function buildApiChangelogAtom(): string {
	const entries = [...API_CHANGELOG.entries].sort(
		(a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
	)
	const updated = entries[0]?.publishedAt ?? '2026-08-21T00:00:00.000Z'
	const body = entries
		.map(
			(entry) => `  <entry>
    <id>tag:suwappu.bot,2026:api-changelog/${xmlEscape(entry.id)}</id>
    <title>${xmlEscape(`[${entry.category}] ${entry.title}`)}</title>
    <updated>${xmlEscape(entry.publishedAt)}</updated>
    <link href="${xmlEscape(entry.documentationUrl)}" />
    <summary>${xmlEscape(entry.summary)}</summary>
  </entry>`,
		)
		.join('\n')

	return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>https://api.suwappu.bot/v1/api-changelog.atom</id>
  <title>Suwappu API Changelog</title>
  <updated>${xmlEscape(updated)}</updated>
  <link rel="self" href="https://api.suwappu.bot/v1/api-changelog.atom" />
  <link rel="alternate" href="https://api.suwappu.bot/v1/api-changelog" />
${body}
</feed>
`
}
