import { describe, expect, it } from '@jest/globals';

import { DEV_TOOLS, devToolsEnabled } from '../config';

describe('devToolsEnabled', () => {
  it('w dev (__DEV__) zawsze włączone', () => {
    expect(devToolsEnabled(true, undefined)).toBe(true);
    expect(devToolsEnabled(true, '0')).toBe(true);
  });

  it('w buildzie tylko z EXPO_PUBLIC_DEV_TOOLS=1', () => {
    expect(devToolsEnabled(false, undefined)).toBe(false);
    expect(devToolsEnabled(false, '')).toBe(false);
    expect(devToolsEnabled(false, '0')).toBe(false);
    expect(devToolsEnabled(false, 'true')).toBe(false);
    expect(devToolsEnabled(false, '1')).toBe(true);
    expect(devToolsEnabled(false, ' 1 ')).toBe(true);
  });

  it('testy działają jak dev', () => {
    expect(DEV_TOOLS).toBe(true);
  });
});
