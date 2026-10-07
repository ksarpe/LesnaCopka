/**
 * Konto (tryb Supabase) – czyste funkcje: adres e-mail, kod z e-maila, komunikaty błędów logowania po polsku,
 * odliczanie „Wyślij kod ponownie”, adres lokalnej skrzynki (Mailpit). Testy: src/utils/__tests__/account.test.ts.
 * Kontrakt błędów GoTrue: docs/backend.md → „Etap 6”.
 */

/** Kod z e-maila: 6 cyfr (`otp_length` w supabase/config.toml). */
export const CODE_LENGTH = 6;
/** Ważność kodu (`otp_expiry = 900`). */
export const CODE_TTL_MS = 15 * 60_000;
/** „Wyślij kod ponownie” – odliczanie (w chmurze `max_frequency` = 60 s). */
export const RESEND_COOLDOWN_S = 60;

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailError(input: string): string | null {
  const e = normalizeEmail(input);
  if (!e) return 'Podaj adres e-mail';
  if (e.length > 254 || !EMAIL_RE.test(e)) return 'To nie wygląda na adres e-mail';
  return null;
}

/** Tylko cyfry, najwyżej CODE_LENGTH (wklejony „123 456” → „123456”). */
export function codeDigits(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export const isCompleteCode = (code: string) => code.length === CODE_LENGTH && /^\d+$/.test(code);

/** Sekundy do ponownego wysłania kodu (0 = można). */
export function resendLeft(sentAt: number | null, now: number, cooldownS = RESEND_COOLDOWN_S): number {
  if (sentAt == null) return 0;
  return Math.max(0, Math.ceil(cooldownS - (now - sentAt) / 1000));
}

/** Po co kod: przypięcie adresu do konta (anonimowe → stałe) albo logowanie na istniejące konto. */
export type CodePurpose = 'link' | 'login';

export type AuthErrorKind =
  | 'network'
  | 'invalid_email'
  | 'email_taken'
  | 'no_account'
  | 'bad_code'
  | 'expired_code'
  | 'rate_limit'
  | 'unknown';

export interface AuthFailure {
  kind: AuthErrorKind;
  message: string;
}

/** Błąd supabase-js (AuthApiError / AuthRetryableFetchError) albo cokolwiek innego → kod, status, treść. */
function parts(e: unknown): { code: string; status: number; message: string } {
  if (e && typeof e === 'object') {
    const o = e as { code?: unknown; status?: unknown; message?: unknown; name?: unknown };
    return {
      code: typeof o.code === 'string' ? o.code : '',
      status: typeof o.status === 'number' ? o.status : 0,
      message: typeof o.message === 'string' ? o.message : String(e),
    };
  }
  return { code: '', status: 0, message: String(e) };
}

/**
 * Błąd kroku logowania → komunikat po polsku. GoTrue nie odróżnia złego kodu od wygasłego (`403 otp_expired` w obu
 * przypadkach) – rozstrzyga czas wysłania kodu (`sentAt`): po 15 min „kod wygasł”, wcześniej „zły kod”.
 */
export function authFailure(
  e: unknown,
  ctx: { step: 'send' | 'verify'; purpose: CodePurpose; sentAt?: number | null; now?: number },
): AuthFailure {
  const { code, status, message } = parts(e);
  const m = message.toLowerCase();
  if (code === 'otp_expired' || (ctx.step === 'verify' && (status === 403 || m.includes('expired') || m.includes('invalid')))) {
    const expired = ctx.sentAt != null && (ctx.now ?? Date.now()) - ctx.sentAt >= CODE_TTL_MS;
    return expired
      ? { kind: 'expired_code', message: 'Kod wygasł – wyślij nowy' }
      : { kind: 'bad_code', message: 'Zły kod – sprawdź cyfry z ostatniego e-maila (albo wyślij nowy kod)' };
  }
  if (code === 'email_exists' || code === 'user_already_exists' || m.includes('already been registered')) {
    return {
      kind: 'email_taken',
      message: 'Ten adres ma już konto w Grzybobraniu – zaloguj się na nie kodem („Zaloguj się na inne konto”)',
    };
  }
  if (code === 'otp_disabled' || code === 'signup_disabled' || code === 'user_not_found' || m.includes('signups not allowed')) {
    return { kind: 'no_account', message: 'Nie znaleziono konta z tym adresem – najpierw zabezpiecz nim konto na telefonie, na którym grasz' };
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
    return { kind: 'rate_limit', message: 'Za dużo prób – odczekaj chwilę i spróbuj ponownie' };
  }
  if (code === 'validation_failed' || code === 'email_address_invalid' || (status === 400 && m.includes('email'))) {
    return { kind: 'invalid_email', message: 'Ten adres e-mail jest nieprawidłowy' };
  }
  if (code === 'email_address_not_authorized') {
    return { kind: 'invalid_email', message: 'Na ten adres nie możemy teraz wysłać kodu – spróbuj innego' };
  }
  if (!status || status >= 500 || m.includes('network') || m.includes('fetch')) {
    return { kind: 'network', message: 'Brak połączenia z serwerem – spróbuj ponownie' };
  }
  return { kind: 'unknown', message: `Nie udało się – spróbuj ponownie (${code || status})` };
}

/**
 * Lokalna skrzynka z kodami (Mailpit z `npx supabase start`, port 54324) dla adresu API Supabase z .env.local –
 * tylko dla adresów lokalnych / w sieci domowej; w chmurze null (kody przychodzą prawdziwą pocztą).
 */
export function mailCatcherUrl(supabaseUrl: string): string | null {
  const m = /^(https?):\/\/([^/:]+)(?::(\d+))?/.exec(supabaseUrl.trim());
  if (!m) return null;
  const host = m[2];
  const local =
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (!local) return null;
  return `http://${host}:54324`;
}
