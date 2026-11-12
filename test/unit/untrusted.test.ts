import { describe, expect, it } from 'vitest';
import { untrusted } from '../../src/upstream/errors.ts';

describe('untrusted', () => {
  it('quotes the text, so it reads as data', () => {
    expect(untrusted('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('strips control and format characters', () => {
    expect(untrusted('a\u0000b\nc‮d​e')).toBe('"a b c d e"');
  });

  it('caps the text at 500 characters', () => {
    expect(untrusted('x'.repeat(501))).toBe(`"${'x'.repeat(500)}…"`);
    expect(untrusted('x'.repeat(500))).toBe(`"${'x'.repeat(500)}"`);
  });
});
