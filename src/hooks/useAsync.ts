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
  /** Dane już raz przyszły z serwisu (zmiana lokalna może wtedy unieważnić starsze zapytanie w toku). */
  const loaded = useRef(false);
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
      if (id === call.current) {
        loaded.current = true;
        setDataState(res);
      }
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

  /**
   * Zmiana lokalna (optymistyczna albo odpowiedź akcji) jest nowsza niż odświeżenie w toku – starsza odpowiedź jej nie
   * nadpisze (np. przyjęty pojedynek nie wraca do „oczekuje”). Przed pierwszym wczytaniem zapytanie zostaje.
   */
  const setData = useCallback((updater: (prev: T | undefined) => T | undefined) => {
    if (loaded.current) {
      call.current += 1;
      setLoading(false);
    }
    setDataState(updater);
  }, []);
  return { data, loading, error, reload: run, setData };
}
