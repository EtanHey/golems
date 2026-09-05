#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { Dashboard } from "./components/Dashboard.js";

// Set up raw mode for keyboard input
if (process.stdin.isTTY && process.stdin.setRawMode) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
}

// Clean exit on SIGINT
process.on("SIGINT", () => {
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
  }
  process.exit(0);
});

const { waitUntilExit } = render(<Dashboard />, {
  exitOnCtrlC: false,
  stdin: process.stdin,
  stdout: process.stdout,
});

await waitUntilExit();

// Reset terminal
if (process.stdin.isTTY && process.stdin.setRawMode) {
  process.stdin.setRawMode(false);
}
