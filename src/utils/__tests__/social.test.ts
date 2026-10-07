import { describe, expect, it } from '@jest/globals';

import {
  COMMENT_MAX,
  inviteLink,
  inviteMessage,
  matchesUserQuery,
  matchRank,
  normalizeSearch,
  prepareComment,
} from '../social';

describe('prepareComment', () => {
  it('przycina spacje na brzegach, pusty tekst = null', () => {
    expect(prepareComment('  Darz grzyb!  ')).toBe('Darz grzyb!');
    expect(prepareComment('   ')).toBeNull();
    expect(prepareComment('\n\n')).toBeNull();
  });

  it('zostawia maks. jedną pustą linię i normalizuje końce linii', () => {
    expect(prepareComment('Ale okaz!\r\n\r\n\r\n\r\nGdzie?')).toBe('Ale okaz!\n\nGdzie?');
    expect(prepareComment('a   \nb')).toBe('a\nb');
  });

  it(`skraca do ${COMMENT_MAX} znaków`, () => {
    const long = 'grzyb '.repeat(100);
    const out = prepareComment(long)!;
    expect(out.length).toBeLessThanOrEqual(COMMENT_MAX);
    expect(out.endsWith(' ')).toBe(false);
  });
});

describe('wyszukiwanie grzybiarzy', () => {
  const lukasz = { name: 'Łukasz_Borowik', fullName: 'Łukasz Wójcik', handle: '@lukasz.borowik' };
  const ola = { name: 'Ola_W', fullName: 'Aleksandra Wiśniewska', handle: '@ola.w' };

  it('normalizuje polskie znaki i separatory nicków', () => {
    expect(normalizeSearch('Łukasz_Borowik')).toBe('lukasz borowik');
    expect(normalizeSearch('  @Ewa.las ')).toBe('ewa las');
    expect(normalizeSearch('Wiśniewska')).toBe('wisniewska');
  });

  it('dopasowuje po nicku, imieniu, nazwisku i handlu – bez polskich znaków', () => {
    expect(matchesUserQuery(lukasz, 'lukasz')).toBe(true);
    expect(matchesUserQuery(lukasz, 'wojcik')).toBe(true);
    expect(matchesUserQuery(lukasz, 'bor luk')).toBe(true);
    expect(matchesUserQuery(ola, 'ola w')).toBe(true);
    expect(matchesUserQuery(ola, 'olaw')).toBe(true);
    expect(matchesUserQuery(ola, 'wiśniew')).toBe(true);
    expect(matchesUserQuery(ola, 'marek')).toBe(false);
    expect(matchesUserQuery(ola, '   ')).toBe(false);
  });

  it('nick od zapytania wyżej niż trafienie w środku', () => {
    expect(matchRank(ola, 'ola')).toBe(0);
    expect(matchRank(ola, 'wisn')).toBe(1);
    expect(matchRank(lukasz, 'asz')).toBe(2);
  });
});

describe('zaproszenia', () => {
  it('link z handla gracza', () => {
    expect(inviteLink('@kuba.grzyb')).toBe('https://grzybobranie.app/zaproszenie/kuba.grzyb');
    expect(inviteLink('kuba.grzyb')).toBe('https://grzybobranie.app/zaproszenie/kuba.grzyb');
  });

  it('treść zawiera imię i handle', () => {
    const msg = inviteMessage('Kuba', '@kuba.grzyb');
    expect(msg).toContain('Kuba');
    expect(msg).toContain('@kuba.grzyb');
  });
});
