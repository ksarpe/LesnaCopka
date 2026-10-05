import type { Post } from '@/types';
import { AUTHORS } from './users';

const H = 3600_000;
const D = 24 * H;

/** Posty startowe – kolejność i treść 1:1 z ekranu 09. `ageMs` → createdAt względem pierwszego uruchomienia. */
export function initialPosts(now: number): Post[] {
  const at = (ageMs: number) => new Date(now - ageMs).toISOString();
  const visible = (ageMs: number) => ({ createdAt: at(ageMs), publishedAt: at(ageMs), visibleFrom: at(ageMs - 1) });
  return [
    {
      id: 'p-ola-1',
      kind: 'trip',
      author: AUTHORS.ola,
      gminaId: 'suprasl',
      ...visible(2 * D + 3 * H),
      scopes: ['friends', 'gmina'],
      title: 'Poranny obchód po deszczu',
      distanceKm: 5.2,
      durationMin: 160,
      mushrooms: 14,
      species: 6,
      xp: 1940,
      routePrecision: 'approximate',
      highlight: { rarity: 'legendarny', text: 'Szmaciak 2,3 kg' },
      reactions: 48,
      reacted: false,
      comments: 12,
    },
    {
      id: 'p-marek-lvl',
      kind: 'levelup',
      author: AUTHORS.marek,
      gminaId: 'suprasl',
      ...visible(5 * H),
      scopes: ['friends'],
      level: 20,
      badgeName: 'Mistrz Kani',
    },
    {
      id: 'p-bartek-1',
      kind: 'compact',
      author: AUTHORS.bartek,
      gminaId: 'michalowo',
      ...visible(1 * D + 2 * H),
      scopes: ['friends'],
      distanceKm: 3.1,
      mushrooms: 6,
      species: 3,
      xp: 520,
      thumbs: ['rzadki', 'pospolity', 'pospolity'],
    },
    {
      id: 'p-ewa-1',
      kind: 'trip',
      author: AUTHORS.ewa,
      gminaId: 'suprasl',
      ...visible(3 * H),
      scopes: ['gmina'],
      title: 'Kanie na skraju Puszczy',
      distanceKm: 4.4,
      durationMin: 135,
      mushrooms: 9,
      species: 4,
      xp: 1210,
      routePrecision: 'gmina',
      highlight: { rarity: 'epicki', text: 'Czubajka kania 34 cm' },
      reactions: 21,
      reacted: false,
      comments: 4,
    },
    {
      id: 'p-g77-1',
      kind: 'compact',
      author: AUTHORS.grzybiarz,
      gminaId: 'suprasl',
      ...visible(9 * H),
      scopes: ['gmina'],
      distanceKm: 2.6,
      mushrooms: 11,
      species: 2,
      xp: 470,
      thumbs: ['pospolity', 'pospolity', 'pospolity'],
    },
  ];
}

/** Pula wpisów dociąganych przez pull-to-refresh (1–2 na raz). */
export function refreshPool(now: number): Post[] {
  const at = (ageMs: number) => new Date(now - ageMs).toISOString();
  return [
    {
      id: `p-kasia-${now}`,
      kind: 'trip',
      author: AUTHORS.kasia,
      gminaId: 'grodek',
      createdAt: at(4 * 60_000),
      publishedAt: at(4 * 60_000),
      visibleFrom: at(4 * 60_000),
      scopes: ['friends'],
      title: 'Pierwsze rydze w tym roku!',
      distanceKm: 3.8,
      durationMin: 95,
      mushrooms: 8,
      species: 3,
      xp: 760,
      routePrecision: 'approximate',
      highlight: { rarity: 'rzadki', text: 'Mleczaj rydz ×5' },
      reactions: 3,
      reacted: false,
      comments: 0,
    },
    {
      id: `p-tomek-${now}`,
      kind: 'levelup',
      author: AUTHORS.tomek,
      gminaId: 'suprasl',
      createdAt: at(12 * 60_000),
      publishedAt: at(12 * 60_000),
      visibleFrom: at(12 * 60_000),
      scopes: ['friends', 'gmina'],
      level: 12,
      badgeName: 'Ranny ptaszek',
    },
    {
      id: `p-ewa2-${now}`,
      kind: 'compact',
      author: AUTHORS.ewa,
      gminaId: 'suprasl',
      createdAt: at(20 * 60_000),
      publishedAt: at(20 * 60_000),
      visibleFrom: at(20 * 60_000),
      scopes: ['friends', 'gmina'],
      distanceKm: 1.9,
      mushrooms: 5,
      species: 2,
      xp: 310,
      thumbs: ['pospolity', 'rzadki', 'pospolity'],
    },
  ];
}
