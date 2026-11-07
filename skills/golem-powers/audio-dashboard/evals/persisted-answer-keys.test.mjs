import { test, expect } from 'bun:test';
import { persistedAnswerKeys } from '../src/prepare-hosted.mjs';
test('persisted keys group choices, retain citation notes and exclude device preferences/drafts', () => {
  const keys = persistedAnswerKeys(`<article class="df-card" data-decision="d"><button class="df-card-note"></button>
    <input type="radio" name="d" value="yes"><input type="radio" name="d" value="no">
    <input type="checkbox" class="df-check-input" data-check-index="0"><textarea class="note-area df-free" data-note="d-free"></textarea></article>
    <select id="df-speed"><option value="1">1</option></select><textarea id="df-note-text"></textarea>`);
  expect(keys).toEqual([{ key: 'd-notes', kind: 'text' }, { key: 'd', kind: 'radio', options: ['yes', 'no'] },
    { key: 'd-checks', kind: 'checkbox', options: ['0'] }, { key: 'd-free', kind: 'text' }]);
});
test('cinema records prefixed scene notes and both consumers of decision free text', () => {
  expect(persistedAnswerKeys(`<script data-answer-consumer="notes"></script><textarea class="note-area" data-note="scene"></textarea>
    <section class="dbx-card"><textarea class="note-area dbx-free" data-note="d-free"></textarea></section>`))
    .toEqual([{ key: '_notes:scene', kind: 'text' }, { key: 'd-free', kind: 'text' }, { key: '_notes:d-free', kind: 'text' }]);
});
test('a persisted textarea without an identity fails closed', () => {
  expect(() => persistedAnswerKeys('<textarea class="note-area df-free"></textarea>')).toThrow('PERSISTED_ANSWER_KEY_REQUIRED');
});
