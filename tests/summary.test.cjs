const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/summary.js');

const json = JSON.stringify({ summary: 'Covers Python basics.', key_points: [{ time: '1:00', point: 'Variables' }], fits_intent: 'yes', verdict: 'Watch.' });
test('Gemini replies are read whatever shape the text arrives in, skipping thinking', () => {
  const shapes = {
    outputText: { output_text: json },
    // The live reply shape seen on 2026-11-11: steps[thought, model_output].
    stepsContent: { id: 'x', status: 'completed', usage: {}, steps: [{ type: 'thought', summary: [{ type: 'text', text: 'I will check the video' }], content: [{ type: 'text', text: 'thinking' }] }, { type: 'model_output', content: [{ type: 'text', text: json }] }], object: 'interaction' },
    stepsDirectText: { steps: [{ type: 'thought', text: 'thinking' }, { type: 'model_output', text: json }] },
    stepsOutputs: { steps: [{ type: 'thought' }, { type: 'model_output', outputs: [{ type: 'text', text: json }] }] },
    thoughtThenText: { id: 'x', outputs: [{ type: 'thought', summary: [{ type: 'text', text: 'I will analyse it' }] }, { type: 'text', text: json }] },
    thoughtWithText: { outputs: [{ type: 'thought', text: 'thinking…' }, { type: 'text', text: json }] },
    messageContent: { output: [{ type: 'message', content: [{ type: 'output_text', text: json }] }] },
    generateContent: { candidates: [{ content: { parts: [{ text: 'plan', thought: true }, { text: json }] } }] },
    fenced: { outputs: [{ type: 'text', text: '```json\n' + json + '\n```' }] },
    sentenceAround: { outputs: [{ type: 'text', text: `Here you go: ${json} Enjoy.` }] },
    splitText: { outputs: [{ type: 'text', text: json.slice(0, 30) }, { type: 'text', text: json.slice(30) }] }
  };
  for (const [name, body] of Object.entries(shapes)) {
    const result = C.parse(body);
    assert.equal(result.summary, 'Covers Python basics.', name);
    assert.equal(result.fitsIntent, 'yes', name);
    assert.deepEqual(result.keyPoints, [{ time: '1:00', point: 'Variables' }], name);
  }
});
test('plain-prose replies are shown and malformed structured replies can be retried', () => {
  assert.equal(C.parse({ outputs: [{ type: 'text', text: 'A quick intro to Python.' }] }).summary, 'A quick intro to Python.');
  for (const body of ['{"verdict":"Watch it","summary":"Some', '[]', '```json\n{"wrongField":true}\n```',
    { id: 'secret-id', outputs: [{ type: 'thought', text: 'private thinking' }], usage: {} }]) {
    assert.throws(() => C.parse(body), { message: 'Gemini returned an unreadable summary. Try again.' });
  }
});
test('key formats: old AIza keys and new AQ. auth keys; junk is rejected', () => {
  assert.equal(C.validKey('AIzaSyA' + 'a'.repeat(32)), true);
  assert.equal(C.validKey('AQ.Ab8RN6' + 'x'.repeat(48)), true);
  for (const bad of ['', 'short', 'AQ.' + 'x'.repeat(300), 'has space ' + 'x'.repeat(40), '<script>' + 'x'.repeat(40)]) assert.equal(C.validKey(bad), false, bad.slice(0, 12));
});
