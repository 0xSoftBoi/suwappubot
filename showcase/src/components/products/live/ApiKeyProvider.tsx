'use client';

import { createContext, useContext } from 'react';

/** Carries the page slug so widgets and the key bar tag first-party events. The key itself lives in keyStore. */
const SlugCtx = createContext('product');
export const useLiveSlug = () => useContext(SlugCtx);

export default function ApiKeyProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  return <SlugCtx.Provider value={slug}>{children}</SlugCtx.Provider>;
}
export { useApiKey } from './keyStore';
