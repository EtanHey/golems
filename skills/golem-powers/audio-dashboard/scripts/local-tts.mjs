#!/usr/bin/env bun
import { main } from "../vendor/narrationlayer/local-tts-runner.ts";
import { prepareSpeechChannels } from "../src/spoken-form.mjs";

main(prepareSpeechChannels).catch(error => {
  console.error(`local-tts: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
