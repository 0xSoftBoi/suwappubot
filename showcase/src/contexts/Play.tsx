'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface PlayContextValue {
  play: boolean;
  setPlay: (v: boolean) => void;
  end: boolean;
  setEnd: (v: boolean) => void;
  hasScroll: boolean;
  setHasScroll: (v: boolean) => void;
}

const PlayContext = createContext<PlayContextValue | undefined>(undefined);

export function PlayProvider({ children }: { children: ReactNode }) {
  const [play, setPlay] = useState(false);
  const [end, setEnd] = useState(false);
  const [hasScroll, setHasScroll] = useState(false);

  return (
    <PlayContext.Provider value={{ play, setPlay, end, setEnd, hasScroll, setHasScroll }}>
      {children}
    </PlayContext.Provider>
  );
}

export function usePlay() {
  const ctx = useContext(PlayContext);
  if (!ctx) throw new Error('usePlay must be used within PlayProvider');
  return ctx;
}
