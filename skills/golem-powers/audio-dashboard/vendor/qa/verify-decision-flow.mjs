#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import path from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("usage: bun vendor/qa/verify-decision-flow.mjs <dashboard.html>");
  process.exit(2);
}

let html;
try {
  html = readFileSync(target, "utf8");
} catch (error) {
  console.error(JSON.stringify({
    file: path.resolve(target),
    pass: false,
    error: `cannot read file: ${error.message}`,
  }, null, 2));
  process.exit(1);
}
const tpdataMatch = html.match(/<script[^>]*id=["']tpdata["'][^>]*>([\s\S]*?)<\/script>/i);
let tpdata = {};
try {
  tpdata = tpdataMatch ? JSON.parse(tpdataMatch[1]) : {};
} catch (error) {
  console.error(JSON.stringify({ file: path.resolve(target), pass: false, error: `invalid tpdata: ${error.message}` }, null, 2));
  process.exit(1);
}

const cards = [...html.matchAll(/<article class="df-card[^>]*>[\s\S]*?<\/article>/g)];
const decisionIds = cards.map((match) => match[0].match(/data-decision="([^"]+)"/)?.[1]).filter(Boolean);
const ownedScenes = cards.flatMap((match) => [...match[0].matchAll(/data-audio-scene="([^"]+)"/g)].map((scene) => scene[1]));
const tpdataIds = Object.keys(tpdata);
const chipIds = [...html.matchAll(/<button type="button" class="df-chip" data-chip-for="([^"]+)"/g)].map((match) => match[1]);
const checklists = cards.flatMap((match) => [...match[0].matchAll(/<fieldset class="df-checklist" data-checklist-for="([^"]+)"/g)]
  .map((list) => ({ owner: match[0].match(/data-decision="([^"]+)"/)?.[1], claimed: list[1] })));
const checklistsOutsideCards = (html.match(/class="df-checklist"/g) || []).length - checklists.length;
const checklistItems = cards.reduce((sum, match) => sum + (match[0].match(/class="df-check-input"/g) || []).length, 0);
const scenesWithWords = tpdataIds.filter((sceneId) => {
  const timing = tpdata[sceneId];
  const words = timing?.cues?.[0]?.words;
  if (!timing?.realWordTiming || !Array.isArray(words) || words.length === 0) return false;
  return words.every((word, index) => {
    const start = Number(word.start);
    const end = Number(word.end);
    const previousEnd = index ? Number(words[index - 1].end) : -Infinity;
    return Boolean(word.word) && Number.isFinite(start) && Number.isFinite(end) && end > start && start >= previousEnd - 0.001;
  });
});

const report = {
  file: path.resolve(target),
  bytes: Buffer.byteLength(html),
  metaCharsetUtf8: /<meta\s+charset=["']utf-8["']\s*\/?\s*>/i.test(html),
  dashboardType: html.includes('data-dashboard-type="decision-flow"'),
  cards: cards.length,
  uniqueDecisionIds: new Set(decisionIds).size,
  cardPlayButtons: (html.match(/class="df-play"/g) || []).length,
  cardTeleprompters: (html.match(/class="df-teleprompter"/g) || []).length,
  noteAreas: (html.match(/class="[^"]*\bnote-area\b[^"]*"/g) || []).length,
  audioDataUris: (html.match(/data:audio\/mpeg;base64,/g) || []).length,
  ownedSceneIds: ownedScenes.length,
  uniqueOwnedSceneIds: new Set(ownedScenes).size,
  tpdataSceneIds: tpdataIds.length,
  scenesWithWords: `${scenesWithWords.length}/${tpdataIds.length}`,
  wordClickSeek: /currentTime\s*=\s*Number\(word\.dataset\.wordStart\)/.test(html),
  copyAnswers: html.includes('id="df-copy"') && html.includes("localStorage.setItem"),
  nextAndSkip: html.includes('class="df-next"') && html.includes('class="df-skip"'),
  controllerChips: chipIds.length,
  chipsMatchCards: chipIds.length === decisionIds.length && chipIds.every((id, index) => id === decisionIds[index]),
  cardTransport: ['id="df-transport-prev"', 'id="df-transport-play"', 'id="df-transport-next"'].every((marker) => html.includes(marker)),
  speedSelector: /<select id="df-speed">[\s\S]*?<option value="1"[\s>]/.test(html) && /\.playbackRate\s*=\s*rate/.test(html),
  viewToggle: html.includes('id="df-view-toggle"') && html.includes("aria-pressed"),
  checklistItems,
  checklistsOwnedByCards: checklistsOutsideCards === 0 && checklists.every((list) => list.owner === list.claimed),
  checklistPersistence: checklistItems === 0 || /\+"-checks"\]/.test(html),
  noCinemaOrGlobalPlayAll: !html.includes('id="cinema"')
    && !html.includes('id="pa-bar"')
    && !html.includes('id="golem-playall-bar"')
    && !html.includes('data-transport="single"'),
  mojibakeMatches: (html.match(/(?:Ã.|â€|�)/g) || []).length,
};

report.pass = report.metaCharsetUtf8
  && report.dashboardType
  && report.cards > 0
  && report.uniqueDecisionIds === report.cards
  && report.cardPlayButtons === report.cards
  && report.cardTeleprompters === report.cards
  && report.noteAreas === report.cards
  && report.audioDataUris === report.tpdataSceneIds
  && report.ownedSceneIds === report.tpdataSceneIds
  && report.uniqueOwnedSceneIds === report.tpdataSceneIds
  && scenesWithWords.length === tpdataIds.length
  && report.wordClickSeek
  && report.copyAnswers
  && report.nextAndSkip
  && report.chipsMatchCards
  && report.cardTransport
  && report.speedSelector
  && report.viewToggle
  && report.checklistsOwnedByCards
  && report.checklistPersistence
  && report.noCinemaOrGlobalPlayAll
  && report.mojibakeMatches === 0;

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
