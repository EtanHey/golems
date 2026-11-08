#!/usr/bin/env bun
import { main } from "../vendor/narrationlayer/local-tts-runner.ts";
import { prepareSpeechChannels as prepareSkillSpeechChannels } from "../src/spoken-form.mjs";
import { loadPronunciationRules } from "../vendor/narrationlayer/pronunciation-config.ts";

export function prepareSpeechChannels(text) {
  return prepareSkillSpeechChannels(text, loadPronunciationRules());
}

if (import.meta.main) main(prepareSpeechChannels).catch(error => {
  console.error(`local-tts: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
