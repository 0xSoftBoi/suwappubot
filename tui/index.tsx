#!/usr/bin/env bun
import React from 'react';
import { render } from 'ink';
import { App } from './App';
import { DebugApp } from './DebugApp';

// Check if stdin supports raw mode (interactive terminal)
const isRawModeSupported = process.stdin.isTTY;

if (!isRawModeSupported) {
  console.error('Error: This TUI requires an interactive terminal.');
  console.error('Run directly in a terminal (not in background or piped).');
  console.error('\nUsage: bun run tui/index.tsx [--debug]');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
const isDebugMode = args.includes('--debug') || args.includes('-d') || args.includes('debug');

// Clear screen and render
console.clear();

if (isDebugMode) {
  console.log('Starting Debug Console...\n');
  const { waitUntilExit } = render(<DebugApp />);
  waitUntilExit().then(() => {
    console.log('Debug console closed.');
  });
} else {
  const { waitUntilExit } = render(<App />);
  waitUntilExit().then(() => {
    console.log('Goodbye!');
  });
}
