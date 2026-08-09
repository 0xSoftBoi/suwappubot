export function phantomBrowseUrl(targetUrl: string, referrerOrigin: string): string {
  return `https://phantom.app/ul/browse/${encodeURIComponent(targetUrl)}?ref=${encodeURIComponent(referrerOrigin)}`
}

export function metamaskDappUrl(targetUrl: string): string {
  const dappPath = targetUrl.replace(/^https?:\/\//i, '')
  return `https://link.metamask.io/dapp/${dappPath}`
}
