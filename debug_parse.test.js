import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseSource } = require('./debug_parse.cjs');

describe('debug_parse', () => {
  it('accepts template text after an interpolation', () => {
    expect(() => parseSource('const label = `${value})`;')).not.toThrow();
  });

  it('accepts strings inside template expressions', () => {
    const source = 'const label = `${value ? ")" : "("}`;';

    expect(() => parseSource(source)).not.toThrow();
  });
});
