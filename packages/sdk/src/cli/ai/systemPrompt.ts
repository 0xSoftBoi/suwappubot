/**
 * Assembles the system prompt handed to any of the three `suwappu ai`
 * backends: fixed Suwappu agent context, plus the local lessons file when
 * present. Kept as a pure function of its inputs so it's testable without
 * touching the filesystem — see buildSystemPromptFromDisk() for the I/O shim.
 */
import { readLessonsFile } from "./harness.js";

export const BASE_SYSTEM_PROMPT = `You are an AI assistant embedded in the \`suwappu\` command-line tool.

Suwappu is cross-chain DEX and liquidity infrastructure: swaps, quotes,
portfolio tracking, and agent-account management across 7+ chains. You are
helping a developer or an autonomous agent use the \`suwappu\` CLI from a
terminal.

Available \`suwappu\` commands the user can run: \`chains\`, \`tokens\`,
\`prices\`, \`portfolio\`, \`quote\`, \`swap\`, \`swap-status\`, \`me\`, \`billing\`,
\`auth\`, \`register\`, and \`ai\` (this assistant). Every command supports
\`-o json\` for machine-parseable output. Prefer pointing the user at the
concrete command and flags over vague advice, and never fabricate a command
that isn't in this list.`;

/** Pure assembly — pass the lessons file contents in, or omit for none. */
export function buildSystemPrompt(lessonsContent?: string): string {
  const trimmed = lessonsContent?.trim();
  if (!trimmed) return BASE_SYSTEM_PROMPT;
  return `${BASE_SYSTEM_PROMPT}\n\n## Learned lessons\n\n${trimmed}\n`;
}

/** Reads ~/.suwappu/harness/lessons.md (if any) and builds the full prompt. */
export function buildSystemPromptFromDisk(): string {
  return buildSystemPrompt(readLessonsFile());
}
