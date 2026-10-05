import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ServiceError } from '@/services/types';

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: ServiceError | Error | null;
  reload: () => Promise<void>;
  setData: (updater: (prev: T | undefined) => T | undefined) => void;
}

/** Minimalny loader danych z serwisów: loading / error / reload (bez zewnętrznych bibliotek). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ServiceError | Error | null>(null);
  const call = useRef(0);
  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });

  const run = useCallback(async () => {
    const id = ++call.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fnRef.current();
      if (id === call.current) setDataState(res);
    } catch (e) {
      if (id === call.current) setError(e as Error);
    } finally {
      if (id === call.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Pobranie danych z serwisu przy zmianie zależności (stan loading ustawiany w run()).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((updater: (prev: T | undefined) => T | undefined) => setDataState(updater), []);
  return { data, loading, error, reload: run, setData };
}
