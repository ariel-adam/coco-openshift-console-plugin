import { CDH_PATH_SEGMENTS, isValidCdhResourcePath } from './cdhPath';

describe('isValidCdhResourcePath', () => {
  it('accepts a three-segment <repository>/<name>/<key> path', () => {
    expect(isValidCdhResourcePath('default/kbsres1/key1')).toBe(true);
    expect(isValidCdhResourcePath('my-repo/my-secret/my-key')).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidCdhResourcePath('  default/kbsres1/key1  ')).toBe(true);
  });

  it('rejects a two-segment folder path (the silent-404 case)', () => {
    expect(isValidCdhResourcePath('default/kbsres1')).toBe(false);
  });

  it('rejects a one-segment path', () => {
    expect(isValidCdhResourcePath('default')).toBe(false);
  });

  it('rejects a four-or-more-segment path', () => {
    expect(isValidCdhResourcePath('default/kbsres1/key1/extra')).toBe(false);
  });

  it('rejects empty / whitespace-only input', () => {
    expect(isValidCdhResourcePath('')).toBe(false);
    expect(isValidCdhResourcePath('   ')).toBe(false);
  });

  it('rejects leading or trailing slashes', () => {
    expect(isValidCdhResourcePath('/default/kbsres1/key1')).toBe(false);
    expect(isValidCdhResourcePath('default/kbsres1/key1/')).toBe(false);
  });

  it('rejects empty interior segments', () => {
    expect(isValidCdhResourcePath('default//key1')).toBe(false);
  });

  it('exposes the required segment count as a constant', () => {
    expect(CDH_PATH_SEGMENTS).toBe(3);
  });
});
