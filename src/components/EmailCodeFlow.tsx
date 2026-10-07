import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, TextInput, View } from 'react-native';

import { DEV_TOOLS } from '@/config';
import { useNow } from '@/hooks/useNow';
import { SUPABASE_URL } from '@/services/supabase/client';
import { colors, fonts, shadows } from '@/theme/tokens';
import {
  authFailure,
  codeDigits,
  CODE_LENGTH,
  emailError,
  isCompleteCode,
  mailCatcherUrl,
  normalizeEmail,
  resendLeft,
  type AuthFailure,
  type CodePurpose,
} from '@/utils/account';
import { Button3D } from './Button3D';
import { Icon } from './Icon';
import { TextField } from './TextField';
import { Txt } from './Txt';

interface EmailCodeFlowProps {
  /** link = zabezpieczenie bieżącego konta adresem; login = logowanie na konto z tym adresem. */
  purpose: CodePurpose;
  /** Wysłanie kodu (rzuca błąd GoTrue – komunikat robi authFailure). */
  send: (email: string) => Promise<void>;
  /** Sprawdzenie kodu (rzuca błąd GoTrue); `false` = przerwane bez błędu (np. anulowane potwierdzenie). */
  verify: (email: string, code: string) => Promise<boolean | void>;
  initialEmail?: string;
  onCancel?: () => void;
  /** link: adres ma już konto → przejście do logowania tym adresem. */
  onUseLogin?: (email: string) => void;
}

const COPY: Record<CodePurpose, { send: string; hint: string; verify: string }> = {
  link: {
    send: 'Wyślij kod',
    hint: 'Wyślemy 6-cyfrowy kod. Po jego wpisaniu adres zostanie przypisany do Twojego konta – postępy zostają.',
    verify: 'Zabezpiecz konto',
  },
  login: {
    send: 'Wyślij kod logowania',
    hint: 'Podaj adres, którym zabezpieczono konto. Wyślemy na niego 6-cyfrowy kod.',
    verify: 'Zaloguj się',
  },
};

/** Adres e-mail → 6-cyfrowy kod z e-maila (zabezpieczenie konta i logowanie). Odliczanie ponownego wysłania: 60 s. */
export function EmailCodeFlow({ purpose, send, verify, initialEmail = '', onCancel, onUseLogin }: EmailCodeFlowProps) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);
  const [touched, setTouched] = useState(false);
  const now = useNow(1000, step === 'code');
  const codeRef = useRef<TextInput>(null);
  const lastAuto = useRef('');
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const addr = normalizeEmail(email);
  const emailErr = touched ? emailError(email) : null;
  const left = resendLeft(sentAt, now);
  const copy = COPY[purpose];
  const mailbox = DEV_TOOLS ? mailCatcherUrl(SUPABASE_URL) : null;

  const doSend = async () => {
    setTouched(true);
    if (emailError(email) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await send(addr);
      if (!mounted.current) return;
      setSentAt(Date.now());
      setCode('');
      lastAuto.current = '';
      setStep('code');
      setTimeout(() => codeRef.current?.focus(), 250);
    } catch (e) {
      if (mounted.current) setError(authFailure(e, { step: 'send', purpose }));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const doVerify = async (value = code) => {
    if (!isCompleteCode(value) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verify(addr, value);
    } catch (e) {
      if (mounted.current) setError(authFailure(e, { step: 'verify', purpose, sentAt }));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const onCode = (t: string) => {
    const digits = codeDigits(t);
    setCode(digits);
    setError(null);
    // Komplet cyfr (wpisany albo wklejony / z autouzupełnienia) – sprawdzamy od razu, raz na dany kod.
    if (isCompleteCode(digits) && lastAuto.current !== digits) {
      lastAuto.current = digits;
      void doVerify(digits);
    }
  };

  if (step === 'email') {
    return (
      <View style={{ gap: 14 }}>
        <TextField
          label="Adres e-mail"
          icon="mail"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            setError(null);
          }}
          onBlur={() => setTouched(true)}
          error={emailErr ?? (error ? error.message : null)}
          hint={copy.hint}
          placeholder="twoj.adres@poczta.pl"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={() => void doSend()}
        />
        {error?.kind === 'email_taken' && onUseLogin ? (
          <LinkButton icon="login" label="Zaloguj się na konto z tym adresem" onPress={() => onUseLogin(addr)} />
        ) : null}
        <Button3D title={busy ? 'Wysyłanie…' : copy.send} icon="send" size="md" onPress={() => void doSend()} disabled={busy || !addr} />
        {onCancel ? <LinkButton label="Anuluj" onPress={onCancel} /> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <Txt f="n6" size={14} color={colors.bodyDark} lh={1.45}>
        Wpisz {CODE_LENGTH}-cyfrowy kod, który wysłaliśmy na{' '}
        <Txt f="n8" size={14}>
          {addr}
        </Txt>
        . Kod jest ważny 15 minut. Nie widzisz e-maila? Zajrzyj do spamu.
      </Txt>
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 18,
          borderWidth: 2,
          borderColor: error ? colors.danger : colors.primary,
          boxShadow: shadows.card,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Icon name="pin" size={24} color={colors.faint} />
        <TextInput
          ref={codeRef}
          value={code}
          onChangeText={onCode}
          placeholder={'0'.repeat(CODE_LENGTH)}
          placeholderTextColor={colors.disabled}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={CODE_LENGTH + 2}
          accessibilityLabel="Kod z e-maila"
          editable={!busy}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: fonts.nunito800,
            fontSize: 28,
            letterSpacing: 10,
            color: colors.ink,
            paddingVertical: 12,
            outlineWidth: 0,
          }}
        />
        {busy ? <ActivityIndicator color={colors.primary} /> : null}
      </View>
      {error ? (
        <Txt f="n7" size={13} color={colors.danger} style={{ paddingHorizontal: 4 }}>
          {error.message}
        </Txt>
      ) : null}
      <Button3D title={copy.verify} icon="check" size="md" onPress={() => void doVerify()} disabled={busy || !isCompleteCode(code)} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 18, rowGap: 6 }}>
        <LinkButton
          icon="refresh"
          label={left > 0 ? `Wyślij ponownie za ${left} s` : 'Wyślij kod ponownie'}
          disabled={left > 0 || busy}
          onPress={() => void doSend()}
        />
        <LinkButton
          icon="edit"
          label="Zmień adres"
          onPress={() => {
            setStep('email');
            setError(null);
            setCode('');
          }}
        />
      </View>
      {mailbox ? (
        <LinkButton icon="inbox" label="Skrzynka testowa (Mailpit, dev)" onPress={() => void Linking.openURL(mailbox).catch(() => {})} />
      ) : null}
      {onCancel ? <LinkButton label="Anuluj" onPress={onCancel} /> : null}
    </View>
  );
}

function LinkButton({ label, icon, onPress, disabled }: { label: string; icon?: 'login' | 'refresh' | 'edit' | 'inbox'; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        gap: 6,
        paddingVertical: 6,
        opacity: disabled ? 0.45 : pressed ? 0.6 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={18} color={colors.outlineText} /> : null}
      <Txt f="b7" size={15} color={colors.outlineText}>
        {label}
      </Txt>
    </Pressable>
  );
}
