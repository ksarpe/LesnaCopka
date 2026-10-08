/**
 * Onboarding (pierwsze uruchomienie, app/onboarding.tsx) – czyste funkcje. Jeden ekran i jedno dotknięcie: przycisk
 * „Zaczynamy!” z oświadczeniem tuż nad nim (regulamin z zasadami bezpieczeństwa, polityka prywatności, wiek).
 * Bez pól wyboru i bez kroków: profil ma wartości domyślne (zmiana w Ustawieniach → Edytuj profil), gminę domową
 * przyjmuje pierwsze wykrycie GPS (shouldAdoptHomeGmina), a o zgody systemowe pytamy dopiero, gdy są potrzebne.
 * Testy: src/utils/__tests__/onboarding.test.ts.
 */
import type { LegalDocId } from '@/data/legal';

/** Napis na przycisku, którego naciśnięcie = akceptacja (oświadczenie cytuje go dosłownie). */
export const ONBOARDING_CTA = 'Zaczynamy';

/** Fragment oświadczenia – zwykły tekst albo link do pełnego dokumentu. */
export interface ConsentPart {
  text: string;
  doc?: LegalDocId;
}

/**
 * Oświadczenie przy przycisku „Zaczynamy!”. Naciśnięcie przycisku = akceptacja regulaminu (z § 4 – zasady
 * bezpieczeństwa) w wersji LEGAL_VERSION i potwierdzenie wieku (§ 3 regulaminu, pkt 13 polityki: 16 lat, młodsi za
 * zgodą rodzica lub opiekuna). Polityka prywatności to informacja (podstawa przetwarzania: umowa – art. 6 ust. 1
 * lit. b RODO, nie zgoda), więc gracz potwierdza, że ją zna, a nie „akceptuje”. Zgód opcjonalnych tu nie ma.
 */
export const ONBOARDING_CONSENT: readonly ConsentPart[] = [
  { text: `Naciskając „${ONBOARDING_CTA}”, akceptujesz ` },
  { text: 'Regulamin', doc: 'regulamin' },
  { text: ' (w tym zasady bezpieczeństwa) i potwierdzasz, że znasz ' },
  { text: 'Politykę prywatności', doc: 'prywatnosc' },
  { text: ' oraz masz ukończone 16 lat (młodsi – tylko za zgodą rodzica lub opiekuna).' },
];

/** Oświadczenie jako zwykły tekst (czytnik ekranu, testy). */
export const consentText = (parts: readonly ConsentPart[] = ONBOARDING_CONSENT) => parts.map((p) => p.text).join('');

/**
 * Czy przyjąć wykrytą gminę jako domową. Tylko gdy gracz jeszcze żadnej nie wybrał (`homeGminaPending`), a z serwerem
 * dopiero po pierwszym przyjęciu stanu konta – wcześniej profil w telefonie to zastępczy gracz, a `profile.update`
 * wysyła cały profil (nick, imię), więc nie może pójść przed stanem z serwera.
 */
export function shouldAdoptHomeGmina(s: { pending: boolean; serverMode: boolean; synced: boolean }): boolean {
  return s.pending && (!s.serverMode || s.synced);
}
