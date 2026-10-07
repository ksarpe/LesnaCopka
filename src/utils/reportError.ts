/**
 * Jeden punkt zgłaszania błędów aplikacji. Teraz: `console.error` (w buildzie – dziennik systemowy telefonu).
 *
 * Sentry (albo inne narzędzie) podpinamy TYLKO tutaj, np. `@sentry/react-native` (+ plugin w app.json):
 *   Sentry.init({ dsn, environment }) – raz, w installGlobalErrorHandlers()
 *   Sentry.captureException(err, { tags: { source }, extra })            – w reportError()
 * Sentry ma własne globalne handlery, więc wtedy installGlobalErrorHandlers sprowadza się do Sentry.init.
 * Uwaga na prywatność: nie wysyłamy współrzędnych GPS (np. w `extra`) – patrz Polityka prywatności, pkt 8.
 */

/** Skąd przyszedł błąd – tag w raporcie: 'boundary' (ekran błędu), 'global', 'promise' albo własny. */
export type ErrorSource = string;

/** Cokolwiek rzucono → Error (string, obiekt z message, undefined…). */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'string') return new Error(e);
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    const err = new Error((e as { message: string }).message);
    if ('name' in e && typeof (e as { name: unknown }).name === 'string') err.name = (e as { name: string }).name;
    return err;
  }
  try {
    return new Error(`Nieznany błąd: ${JSON.stringify(e)}`);
  } catch {
    return new Error('Nieznany błąd');
  }
}

/** Zgłoś błąd. Nigdy nie rzuca – raportowanie nie może wywrócić aplikacji. */
export function reportError(e: unknown, source: ErrorSource, extra?: Record<string, unknown>): Error {
  const err = toError(e);
  try {
    console.error(`[${source}]`, err, ...(extra ? [extra] : []));
    // Tu Sentry.captureException(err, { tags: { source }, extra }).
  } catch {
    // brak konsoli / nieserializowalne extra – ignorujemy
  }
  return err;
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface HermesRejectionTracker {
  enablePromiseRejectionTracker?: (opts: { allRejections: boolean; onUnhandled: (id: number, error: unknown) => void }) => void;
}

let installed = false;

/**
 * Globalne błędy JS i nieobsłużone odrzucenia obietnic → reportError. Tylko w wydaniu: w dev pokazuje je
 * już LogBox (RN włącza wtedy własny tracker odrzuceń Hermesa, którego nie nadpisujemy). Idempotentne.
 * Błąd renderowania łapie osobno ErrorBoundary w app/_layout.tsx.
 */
export function installGlobalErrorHandlers(isDev: boolean = __DEV__): void {
  if (installed || isDev) return;
  installed = true;
  const g = globalThis as typeof globalThis & {
    ErrorUtils?: { getGlobalHandler(): GlobalHandler; setGlobalHandler(h: GlobalHandler): void };
    HermesInternal?: HermesRejectionTracker;
    addEventListener?: (type: string, cb: (ev: { reason?: unknown }) => void) => void;
  };

  // Natywnie: błąd poza Reactem (timer, callback). Zgłaszamy i oddajemy domyślnemu handlerowi RN.
  const errorUtils = g.ErrorUtils;
  if (errorUtils) {
    const prev = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      reportError(error, 'global', { fatal: !!isFatal });
      prev(error, isFatal);
    });
  }

  // Hermes: w wydaniu RN nie śledzi odrzuceń – bez tego błąd w `.then()` bez `.catch()` ginie bez śladu.
  g.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, error) => reportError(error, 'promise'),
  });

  // Web.
  if (!g.ErrorUtils && typeof g.addEventListener === 'function') {
    g.addEventListener('unhandledrejection', (ev) => reportError(ev.reason, 'promise'));
  }
}
