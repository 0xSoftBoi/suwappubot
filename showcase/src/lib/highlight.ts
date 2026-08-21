/**
 * highlight.ts — a deliberately tiny syntax tokenizer for the two static code
 * samples on the homepage (the SDK snippet and the A2A agent-card JSON).
 *
 * Not a general-purpose highlighter: both inputs are trusted build-time
 * constants, so a small regex pass covering strings / keywords / numbers /
 * JSON keys is enough to make the true-black code blocks (D9) read as real
 * syntax-highlighted output instead of flat mono text, without pulling in a
 * highlighting dependency for two short snippets.
 */

export type Token = { text: string; cls?: 'str' | 'kw' | 'num' | 'key' | 'punc' | 'com' };

/** Tokenizes a small TypeScript/JS snippet. */
export function highlightTs(code: string): Token[] {
  const tokens: Token[] = [];
  // Order matters: strings first so keywords inside them are never matched.
  const pattern = /("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b(?:import|from|const|new|await|return|async|function)\b)|(\b\d+(?:\.\d+)?\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(code))) {
    if (m.index > last) tokens.push({ text: code.slice(last, m.index) });
    if (m[1]) tokens.push({ text: m[1], cls: 'str' });
    else if (m[2]) tokens.push({ text: m[2], cls: 'kw' });
    else if (m[3]) tokens.push({ text: m[3], cls: 'num' });
    last = pattern.lastIndex;
  }
  if (last < code.length) tokens.push({ text: code.slice(last) });
  return tokens;
}

/** Tokenizes a small pretty-printed JSON object: keys, string values, punctuation. */
export function highlightJson(code: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /("(?:[^"\\]|\\.)*")(\s*:)?|(\b(?:true|false|null)\b)|([{}[\],])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(code))) {
    if (m.index > last) tokens.push({ text: code.slice(last, m.index) });
    if (m[1]) {
      tokens.push({ text: m[1], cls: m[2] ? 'key' : 'str' });
      if (m[2]) tokens.push({ text: m[2], cls: 'punc' });
    } else if (m[3]) {
      tokens.push({ text: m[3], cls: 'kw' });
    } else if (m[4]) {
      tokens.push({ text: m[4], cls: 'punc' });
    }
    last = pattern.lastIndex;
  }
  if (last < code.length) tokens.push({ text: code.slice(last) });
  return tokens;
}
