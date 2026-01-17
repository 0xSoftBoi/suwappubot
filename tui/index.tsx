#!/usr/bin/env bun
import React from 'react';
import { render } from 'ink';
import { App } from './App';

// Clear screen and render
console.clear();

const { waitUntilExit } = render(<App />);

waitUntilExit().then(() => {
  console.log('Goodbye!');
});
