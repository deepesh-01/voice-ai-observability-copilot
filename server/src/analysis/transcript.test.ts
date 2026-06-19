import { describe, it, expect } from 'vitest';
import { parseTranscript, transcriptToText } from './transcript.js';

describe('parseTranscript', () => {
  it('parses bot/human lines into agent/caller turns', () => {
    const raw = 'bot:Hello there\nhuman:Hi, I need help\n';
    expect(parseTranscript(raw)).toEqual([
      { index: 0, speaker: 'agent', text: 'Hello there' },
      { index: 1, speaker: 'caller', text: 'Hi, I need help' },
    ]);
  });

  it('trims surrounding whitespace on each utterance', () => {
    const raw = 'bot:  spaced out  \nhuman:I am I don\'t know. \n';
    expect(parseTranscript(raw)).toEqual([
      { index: 0, speaker: 'agent', text: 'spaced out' },
      { index: 1, speaker: 'caller', text: "I am I don't know." },
    ]);
  });

  it('merges consecutive same-speaker lines into one turn', () => {
    // Observed in real data: two human lines in a row.
    const raw =
      'bot:Which slot works?\nhuman:Saturday eleven AM as soon as possible.\nhuman:That is what I want.\nbot:Done.\n';
    expect(parseTranscript(raw)).toEqual([
      { index: 0, speaker: 'agent', text: 'Which slot works?' },
      {
        index: 1,
        speaker: 'caller',
        text: 'Saturday eleven AM as soon as possible. That is what I want.',
      },
      { index: 2, speaker: 'agent', text: 'Done.' },
    ]);
  });

  it('keeps colons inside the utterance (splits on first colon only)', () => {
    const raw = 'bot:Your appointment is at 11:00 AM: confirmed\n';
    expect(parseTranscript(raw)).toEqual([
      { index: 0, speaker: 'agent', text: 'Your appointment is at 11:00 AM: confirmed' },
    ]);
  });

  it('treats a line with no known speaker prefix as a continuation', () => {
    const raw = 'bot:Line one\nstill the agent talking\nhuman:ok\n';
    expect(parseTranscript(raw)).toEqual([
      { index: 0, speaker: 'agent', text: 'Line one still the agent talking' },
      { index: 1, speaker: 'caller', text: 'ok' },
    ]);
  });

  it('ignores blank lines and is case-insensitive on the prefix', () => {
    const raw = '\nBOT:Hi\n\nHuman:Hey\n\n';
    expect(parseTranscript(raw)).toEqual([
      { index: 0, speaker: 'agent', text: 'Hi' },
      { index: 1, speaker: 'caller', text: 'Hey' },
    ]);
  });

  it('returns an empty array for empty or whitespace-only input', () => {
    expect(parseTranscript('')).toEqual([]);
    expect(parseTranscript('   \n  \n')).toEqual([]);
    expect(parseTranscript(null)).toEqual([]);
  });

  it('drops a leading orphan continuation with no turn to attach to', () => {
    const raw = 'orphan line\nbot:real start\n';
    expect(parseTranscript(raw)).toEqual([{ index: 0, speaker: 'agent', text: 'real start' }]);
  });
});

describe('transcriptToText', () => {
  it('renders turns back to a readable Agent/Caller script', () => {
    const turns = parseTranscript('bot:Hi\nhuman:Hello\n');
    expect(transcriptToText(turns)).toBe('Agent: Hi\nCaller: Hello');
  });
});
