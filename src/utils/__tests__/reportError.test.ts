import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { reportError, toError } from '../reportError';

type Mod = typeof import('../reportError');
type Handler = (error: unknown, isFatal?: boolean) => void;
type G = typeof globalThis & { ErrorUtils?: unknown; HermesInternal?: unknown };

/** Świeży moduł (flaga `installed` jest modułowa). */
function freshModule(): Mod {
  let mod!: Mod;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../reportError') as Mod;
  });
  return mod;
}

describe('toError', () => {
  it('normalizuje to, co rzucono', () => {
    const e = new TypeError('x');
    expect(toError(e)).toBe(e);
    expect(toError('napis').message).toBe('napis');
    const obj = toError({ message: 'z serwera', name: 'PostgrestError' });
    expect(obj).toBeInstanceOf(Error);
    expect(obj.message).toBe('z serwera');
    expect(obj.name).toBe('PostgrestError');
    expect(toError(undefined).message).toContain('Nieznany błąd');
    expect(toError({ code: 42 }).message).toContain('42');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(toError(cyclic).message).toBe('Nieznany błąd');
  });
});

describe('reportError', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loguje przez console.error ze źródłem i zwraca Error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const err = reportError('boom', 'boundary', { screen: 'scan' });
    expect(err.message).toBe('boom');
    expect(spy).toHaveBeenCalledWith('[boundary]', err, { screen: 'scan' });
  });

  it('nigdy nie rzuca', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('konsola padła');
    });
    expect(() => reportError(new Error('x'), 'global')).not.toThrow();
  });
});

describe('installGlobalErrorHandlers', () => {
  const g = globalThis as G;
  afterEach(() => {
    delete g.ErrorUtils;
    delete g.HermesInternal;
    jest.restoreAllMocks();
  });

  it('w dev nic nie podpina (LogBox)', () => {
    const setGlobalHandler = jest.fn();
    g.ErrorUtils = { getGlobalHandler: () => () => {}, setGlobalHandler };
    freshModule().installGlobalErrorHandlers(true);
    expect(setGlobalHandler).not.toHaveBeenCalled();
  });

  it('w wydaniu: globalny handler zgłasza i oddaje błąd domyślnemu, odrzucenia obietnic też trafiają do raportu', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const prev = jest.fn<Handler>();
    type Tracker = { allRejections: boolean; onUnhandled: (id: number, e: unknown) => void };
    const box: { handler?: Handler; tracker?: Tracker } = {};
    g.ErrorUtils = {
      getGlobalHandler: () => prev,
      setGlobalHandler: (h: Handler) => {
        box.handler = h;
      },
    };
    g.HermesInternal = {
      enablePromiseRejectionTracker: (o: Tracker) => {
        box.tracker = o;
      },
    };

    const mod = freshModule();
    mod.installGlobalErrorHandlers(false);
    mod.installGlobalErrorHandlers(false); // idempotentne

    const boom = new Error('boom');
    box.handler?.(boom, true);
    expect(prev).toHaveBeenCalledTimes(1);
    expect(prev).toHaveBeenCalledWith(boom, true);
    expect(spy).toHaveBeenCalledWith('[global]', boom, { fatal: true });

    expect(box.tracker?.allRejections).toBe(true);
    box.tracker?.onUnhandled(1, 'odrzucone');
    expect(spy).toHaveBeenLastCalledWith('[promise]', expect.objectContaining({ message: 'odrzucone' }));
  });
});
