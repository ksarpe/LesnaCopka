import { describe, expect, it } from '@jest/globals';

import {
  authFailure,
  codeDigits,
  CODE_TTL_MS,
  emailError,
  isCompleteCode,
  mailCatcherUrl,
  normalizeEmail,
  resendLeft,
} from '../account';

/** Błąd jak AuthApiError z supabase-js (status + code). */
const gotrue = (status: number, code: string, message = '') => Object.assign(new Error(message || code), { status, code, name: 'AuthApiError' });

describe('adres e-mail i kod', () => {
  it('normalizacja i walidacja adresu', () => {
    expect(normalizeEmail('  Ola.W@Poczta.PL ')).toBe('ola.w@poczta.pl');
    expect(emailError('')).toBe('Podaj adres e-mail');
    expect(emailError('ola')).toMatch(/nie wygląda/);
    expect(emailError('ola@poczta')).toMatch(/nie wygląda/);
    expect(emailError('ola @poczta.pl')).toMatch(/nie wygląda/);
    expect(emailError(' ola@poczta.pl ')).toBeNull();
  });

  it('kod: tylko cyfry, najwyżej 6 (wklejony z odstępem też)', () => {
    expect(codeDigits('123 456')).toBe('123456');
    expect(codeDigits('12-34-56-78')).toBe('123456');
    expect(codeDigits('abc')).toBe('');
    expect(isCompleteCode('123456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
  });

  it('odliczanie ponownego wysłania: 60 s od wysłania', () => {
    expect(resendLeft(null, 1000)).toBe(0);
    expect(resendLeft(0, 0)).toBe(60);
    expect(resendLeft(0, 59_100)).toBe(1);
    expect(resendLeft(0, 60_000)).toBe(0);
    expect(resendLeft(0, 90_000)).toBe(0);
  });
});

describe('błędy logowania po polsku (kontrakt GoTrue z docs/backend.md → Etap 6)', () => {
  it('403 otp_expired: zły kod albo – po 15 min od wysłania – kod wygasł', () => {
    const sentAt = 1_000_000;
    expect(authFailure(gotrue(403, 'otp_expired'), { step: 'verify', purpose: 'link', sentAt, now: sentAt + 60_000 }).kind).toBe('bad_code');
    expect(authFailure(gotrue(403, 'otp_expired'), { step: 'verify', purpose: 'login', sentAt, now: sentAt + CODE_TTL_MS }).kind).toBe(
      'expired_code',
    );
    expect(authFailure(gotrue(403, 'otp_expired'), { step: 'verify', purpose: 'login' }).message).toMatch(/Zły kod/);
  });

  it('422 email_exists – adres ma już konto (podpowiedź: zaloguj się)', () => {
    const f = authFailure(gotrue(422, 'email_exists'), { step: 'send', purpose: 'link' });
    expect(f.kind).toBe('email_taken');
    expect(f.message).toMatch(/Zaloguj się/);
  });

  it('422 otp_disabled – logowanie na nieznany adres', () => {
    expect(authFailure(gotrue(422, 'otp_disabled', 'Signups not allowed for otp'), { step: 'send', purpose: 'login' }).kind).toBe('no_account');
  });

  it('429 – za dużo prób; 400 validation_failed – zły adres', () => {
    expect(authFailure(gotrue(429, 'over_email_send_rate_limit'), { step: 'send', purpose: 'login' }).kind).toBe('rate_limit');
    expect(authFailure(gotrue(400, 'validation_failed', 'Unable to validate email address: invalid format'), { step: 'send', purpose: 'link' }).kind).toBe(
      'invalid_email',
    );
  });

  it('brak sieci (bez statusu / 5xx) i nieznane', () => {
    expect(authFailure(new TypeError('Network request failed'), { step: 'send', purpose: 'link' }).kind).toBe('network');
    expect(authFailure(gotrue(0, '', 'Failed to fetch'), { step: 'verify', purpose: 'login' }).kind).toBe('network');
    expect(authFailure(gotrue(502, ''), { step: 'send', purpose: 'login' }).kind).toBe('network');
    expect(authFailure(gotrue(409, 'conflict'), { step: 'send', purpose: 'link' }).kind).toBe('unknown');
  });
});

describe('skrzynka z kodami (Mailpit) – tylko adresy lokalne', () => {
  it('Docker na tym komputerze / w sieci domowej → port 54324', () => {
    expect(mailCatcherUrl('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54324');
    expect(mailCatcherUrl('http://192.168.1.23:54321')).toBe('http://192.168.1.23:54324');
    expect(mailCatcherUrl('http://10.0.2.2:54321')).toBe('http://10.0.2.2:54324');
    expect(mailCatcherUrl('http://localhost:54321')).toBe('http://localhost:54324');
  });

  it('chmura i błędne adresy → brak', () => {
    expect(mailCatcherUrl('https://abcd.supabase.co')).toBeNull();
    expect(mailCatcherUrl('')).toBeNull();
    expect(mailCatcherUrl('nie-url')).toBeNull();
  });
});
