import { describe, expect, it } from '@jest/globals';

import {
  bioError,
  BIO_MAX,
  cleanName,
  firstNameOf,
  foldPl,
  handleError,
  nameError,
  normalizeHandle,
  searchByName,
} from '../profile';

describe('profil – walidacja', () => {
  it('imię: czyści spacje i wymaga 2–40 znaków', () => {
    expect(cleanName('  Kuba   Nowak ')).toBe('Kuba Nowak');
    expect(nameError('   ')).toBe('Podaj imię');
    expect(nameError('K')).not.toBeNull();
    expect(nameError('x'.repeat(41))).not.toBeNull();
    expect(nameError('Kuba Nowak')).toBeNull();
  });

  it('imię do powitania to pierwszy wyraz', () => {
    expect(firstNameOf('  Ola   Wiśniewska')).toBe('Ola');
    expect(firstNameOf('Grzybiarz')).toBe('Grzybiarz');
  });

  it('nick: zawsze z „@”, małymi literami', () => {
    expect(normalizeHandle('Kuba.Grzyb')).toBe('@kuba.grzyb');
    expect(normalizeHandle('@@ola_w ')).toBe('@ola_w');
  });

  it('nick: 3–20 znaków a–z, 0–9, kropka, podkreślnik', () => {
    expect(handleError('@kuba.grzyb')).toBeNull();
    expect(handleError('ola_77')).toBeNull();
    expect(handleError('@')).toBe('Podaj nick');
    expect(handleError('ab')).not.toBeNull();
    expect(handleError('a'.repeat(21))).not.toBeNull();
    expect(handleError('kuba grzyb')).not.toBeNull();
    expect(handleError('żaneta')).not.toBeNull();
    expect(handleError('.kuba')).not.toBeNull();
    expect(handleError('kuba.')).not.toBeNull();
    expect(handleError('ku..ba')).not.toBeNull();
  });

  it('bio: najwyżej 120 znaków po przycięciu', () => {
    expect(bioError('x'.repeat(BIO_MAX))).toBeNull();
    expect(bioError(`  ${'x'.repeat(BIO_MAX)}  `)).toBeNull();
    expect(bioError('x'.repeat(BIO_MAX + 1))).not.toBeNull();
  });
});

describe('profil – wyszukiwanie gminy', () => {
  const gminy = [
    { name: 'Supraśl' },
    { name: 'Wysokie Mazowieckie' },
    { name: 'Łomża' },
    { name: 'Michałowo' },
    { name: 'Mońki' },
    { name: 'Nowa Sól' },
  ];

  it('ignoruje wielkość liter i polskie znaki', () => {
    expect(foldPl('ŁÓDŹ')).toBe('lodz');
    expect(searchByName(gminy, 'suprasl').map((g) => g.name)).toEqual(['Supraśl']);
    expect(searchByName(gminy, 'lomza').map((g) => g.name)).toEqual(['Łomża']);
  });

  it('najpierw początek nazwy, potem fragment', () => {
    expect(searchByName(gminy, 'm').map((g) => g.name)).toEqual(['Michałowo', 'Mońki', 'Łomża', 'Wysokie Mazowieckie']);
    expect(searchByName(gminy, 'mazow').map((g) => g.name)).toEqual(['Wysokie Mazowieckie']);
  });

  it('puste zapytanie i limit', () => {
    expect(searchByName(gminy, '  ')).toEqual([]);
    expect(searchByName(gminy, 'o', 2)).toHaveLength(2);
  });
});
