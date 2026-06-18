import { fnv1aHex } from './checksum';

describe('fnv1aHex', () => {
  it('returns the known FNV-1a 32-bit digest for a sample string', () => {
    // "hello" → FNV-1a 32-bit = 0x4f9f2cab (well-known test vector).
    expect(fnv1aHex('hello')).toBe('4f9f2cab');
  });

  it('hashes the empty string to the FNV offset basis', () => {
    expect(fnv1aHex('')).toBe('811c9dc5');
  });

  it('always returns 8 lowercase hex characters', () => {
    const out = fnv1aHex('some-long-initdata-blob-value-1234567890');
    expect(out).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic for the same input', () => {
    expect(fnv1aHex('abc')).toBe(fnv1aHex('abc'));
  });

  it('produces different digests for different inputs', () => {
    expect(fnv1aHex('abc')).not.toBe(fnv1aHex('abd'));
  });
});
