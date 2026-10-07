import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  backoffMs,
  enqueueItem,
  FAILED_LIMIT,
  headDue,
  holdHydration,
  hydrationHeld,
  isPhotoEvent,
  makeItem,
  markAttempt,
  onOutboxKick,
  outboxRevision,
  pushFailed,
  setOutboxEnabled,
  useOutboxStore,
  type OutboxEvent,
  type OutboxItem,
} from '../useOutboxStore';
import type { TripPost } from '@/types';
import { isUuid } from '@/utils/random';

// jest.mock jest wynoszony nad importy (babel-jest) – store dostaje AsyncStorage z pamięci.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const T0 = new Date(2026, 9, 6, 12).getTime();

const start = (tripId = 't1'): OutboxEvent => ({ type: 'trip.start', payload: { tripId, gminaId: 'suprasl', startedAt: '2026-10-06T10:00:00.000Z' } });
const progress = (distanceM: number, tripId = 't1'): OutboxEvent => ({ type: 'trip.progress', payload: { tripId, distanceM } });
const finish = (tripId = 't1'): OutboxEvent => ({
  type: 'trip.finish',
  payload: { tripId, distanceM: 2500, durationS: 3600, endedAt: '2026-10-06T11:00:00.000Z' },
});
const submit = (findId: string): OutboxEvent => ({
  type: 'find.submit',
  payload: {
    findId,
    tripId: 't1',
    gminaId: 'suprasl',
    speciesId: 'borowik-szlachetny',
    rarity: 'rzadki',
    confidence: 0.94,
    xxl: false,
    dimensions: { capCm: 12, heightCm: 14, weightG: 300, ageDays: 4 },
    candidates: [],
    parts: ['cap'],
    foundAt: '2026-10-06T10:30:00.000Z',
  },
});
const claim = (findId: string): OutboxEvent => ({ type: 'find.claim', payload: { findId } });
const discard = (findId: string): OutboxEvent => ({ type: 'find.discard', payload: { findId } });
const profile = (handle: string): OutboxEvent => ({
  type: 'profile.update',
  payload: { displayName: 'Ola W', firstName: 'Ola', handle, homeGminaId: 'suprasl' },
});

const publish = (hideRoute: boolean, tripId = 't1'): OutboxEvent => ({
  type: 'trip.publish',
  payload: { tripId, hideRoute, title: 'Wyprawa po grzyby' },
});
const localPost = (tripId: string): TripPost => ({
  id: `local:${tripId}`,
  kind: 'trip',
  mine: true,
  tripId,
  author: { id: 'me', name: 'Kuba', level: 3, ringRarity: 'primary' },
  gminaId: 'suprasl',
  createdAt: '2026-10-06T11:00:00.000Z',
  publishedAt: '2026-10-06T11:05:00.000Z',
  visibleFrom: '2026-10-07T11:05:00.000Z',
  scopes: ['friends', 'gmina'],
  title: 'Wyprawa po grzyby',
  distanceKm: 2.5,
  durationMin: 60,
  mushrooms: 3,
  species: 2,
  xp: 120,
  routePrecision: 'approximate',
  reactions: 0,
  reacted: false,
  comments: 0,
});

/** Kolejka z kolejnych zdarzeń (bez łączenia). */
const queueOf = (...events: OutboxEvent[]) => events.map((e) => makeItem(e, T0));
const types = (q: OutboxItem[]) => q.map((x) => x.type);

describe('enqueueItem – łączenie zdarzeń', () => {
  it('zwykłe zdarzenia trafiają na koniec (FIFO)', () => {
    const q = enqueueItem(queueOf(start(), submit('f1')), makeItem(claim('f1')));
    expect(types(q)).toEqual(['trip.start', 'find.submit', 'find.claim']);
  });

  it('nowszy dystans wyprawy podmienia czekający raport – na jego miejscu, z licznikiem prób', () => {
    let q = queueOf(start(), progress(400), submit('f1'));
    q = markAttempt(q, q[1].id, 'sieć', T0);
    const id = q[1].id;
    q = enqueueItem(q, makeItem(progress(900)));
    expect(types(q)).toEqual(['trip.start', 'trip.progress', 'find.submit']);
    expect(q[1]).toMatchObject({ id, attempts: 1, payload: { tripId: 't1', distanceM: 900 } });
  });

  it('raport innej wyprawy nie jest łączony', () => {
    const q = enqueueItem(queueOf(progress(400, 't1')), makeItem(progress(100, 't2')));
    expect(q.map((x) => (x.type === 'trip.progress' ? x.payload.distanceM : 0))).toEqual([400, 100]);
  });

  it('wysyłany właśnie raport zostaje, nowy idzie na koniec', () => {
    const q0 = queueOf(progress(400));
    const q = enqueueItem(q0, makeItem(progress(900)), q0[0].id);
    expect(q.map((x) => (x.type === 'trip.progress' ? x.payload.distanceM : 0))).toEqual([400, 900]);
  });

  it('koniec wyprawy usuwa jej czekające raporty dystansu (niesie końcowy dystans), ale nie odbiór znaleziska', () => {
    const q = enqueueItem(queueOf(start(), progress(400), claim('f1'), progress(10, 't2')), makeItem(finish()));
    expect(types(q)).toEqual(['trip.start', 'find.claim', 'trip.progress', 'trip.finish']);
  });

  it('odbiór znaleziska zawsze przed końcem wyprawy', () => {
    let q: OutboxItem[] = [];
    [start(), submit('f1'), claim('f1'), progress(800), finish()].forEach((e) => (q = enqueueItem(q, makeItem(e))));
    expect(types(q)).toEqual(['trip.start', 'find.submit', 'find.claim', 'trip.finish']);
  });

  it('profil: w kolejce czeka tylko najnowsza wersja', () => {
    const q = enqueueItem(queueOf(profile('ola.w'), start()), makeItem(profile('ola.las')));
    expect(types(q)).toEqual(['profile.update', 'trip.start']);
    expect(q[0].type === 'profile.update' && q[0].payload.handle).toBe('ola.las');
  });

  it('porzucone znalezisko, które nie wyszło z telefonu, znika z kolejki bez wysyłania', () => {
    const q = enqueueItem(queueOf(start(), submit('f1'), submit('f2')), makeItem(discard('f1')));
    expect(q.map((x) => ('findId' in x.payload ? x.payload.findId : x.type))).toEqual(['trip.start', 'f2']);
  });

  it('porzucenie znaleziska właśnie wysyłanego albo już wysłanego idzie do kolejki', () => {
    const q0 = queueOf(submit('f1'));
    expect(types(enqueueItem(q0, makeItem(discard('f1')), q0[0].id))).toEqual(['find.submit', 'find.discard']);
    expect(types(enqueueItem([], makeItem(discard('f1'))))).toEqual(['find.discard']);
  });

  it('publikacja idzie za końcem wyprawy; ponowna publikacja tej samej wyprawy podmienia czekającą', () => {
    let q = queueOf(start(), finish());
    q = enqueueItem(q, makeItem(publish(false)));
    q = enqueueItem(q, makeItem(publish(true, 't2')));
    q = enqueueItem(q, makeItem(publish(true)));
    expect(types(q)).toEqual(['trip.start', 'trip.finish', 'trip.publish', 'trip.publish']);
    expect(q.map((x) => (x.type === 'trip.publish' ? `${x.payload.tripId}:${x.payload.hideRoute}` : ''))).toEqual(['', '', 't1:true', 't2:true']);
    // Wysyłana właśnie publikacja zostaje – nowa idzie na koniec.
    const sending = enqueueItem(q, makeItem(publish(false)), q[2].id);
    expect(types(sending).filter((t) => t === 'trip.publish')).toHaveLength(3);
  });

  it('obserwowanie gminy: w kolejce czeka tylko stan docelowy per gmina (na swoim miejscu)', () => {
    const follow = (gminaId: string, on: boolean): OutboxEvent => ({ type: 'gmina.follow', payload: { gminaId, follow: on } });
    let q = queueOf(follow('suprasl', true), start(), follow('hajnowka', true));
    q = enqueueItem(q, makeItem(follow('suprasl', false)));
    expect(types(q)).toEqual(['gmina.follow', 'trip.start', 'gmina.follow']);
    expect(q.map((x) => (x.type === 'gmina.follow' ? `${x.payload.gminaId}:${x.payload.follow}` : ''))).toEqual([
      'suprasl:false',
      '',
      'hajnowka:true',
    ]);
    // Wysyłane właśnie zdarzenie zostaje – nowe idzie na koniec.
    const sending = enqueueItem(q, makeItem(follow('suprasl', true)), q[0].id);
    expect(types(sending)).toEqual(['gmina.follow', 'trip.start', 'gmina.follow', 'gmina.follow']);
  });

  it('przyjęcie wyzwania: czekające to samo wyzwanie nie jest dublowane, inne idzie na koniec (przed odbiorem znaleziska)', () => {
    const accept = (challengeId: string): OutboxEvent => ({ type: 'challenge.accept', payload: { challengeId, gminaId: 'suprasl' } });
    let q = queueOf(start(), accept('ch-1'));
    q = enqueueItem(q, makeItem(accept('ch-1')));
    q = enqueueItem(q, makeItem(accept('ch-2')));
    q = enqueueItem(q, makeItem(claim('f1')));
    expect(types(q)).toEqual(['trip.start', 'challenge.accept', 'challenge.accept', 'find.claim']);
    // Już wysyłane – ponowne przyjęcie trafia do kolejki (idempotentne na serwerze).
    const inFlight = queueOf(accept('ch-1'));
    expect(enqueueItem(inFlight, makeItem(accept('ch-1')), inFlight[0].id)).toHaveLength(2);
  });

  it('zdjęcie znaleziska: po skanie, jedno na znalezisko; porzucenie usuwa czekające zdjęcie', () => {
    const photo = (findId: string): OutboxEvent => ({ type: 'photo.find', payload: { findId } });
    let q = queueOf(start(), submit('f1'), photo('f1'));
    q = enqueueItem(q, makeItem(photo('f1')));
    q = enqueueItem(q, makeItem(claim('f1')));
    expect(types(q)).toEqual(['trip.start', 'find.submit', 'photo.find', 'find.claim']);
    // Skan jeszcze w telefonie – porzucenie zabiera skan i zdjęcie.
    expect(types(enqueueItem(queueOf(start(), submit('f2'), photo('f2')), makeItem(discard('f2'))))).toEqual(['trip.start']);
    // Skan już na serwerze – czekające zdjęcie znika, porzucenie idzie do kolejki.
    expect(types(enqueueItem(queueOf(photo('f3'), photo('f4')), makeItem(discard('f3'))))).toEqual(['photo.find', 'find.discard']);
    // Zdjęcie właśnie wysyłane zostaje (silnik sam posprząta plik porzuconego znaleziska).
    const sending = queueOf(photo('f5'));
    expect(types(enqueueItem(sending, makeItem(discard('f5')), sending[0].id))).toEqual(['photo.find', 'find.discard']);
  });

  it('zdjęcie profilowe: w kolejce tylko najnowsza zmiana (na swoim miejscu); usuwanie plików – na koniec', () => {
    const avatar = (photo: boolean, ts: number): OutboxEvent => ({ type: 'photo.avatar', payload: { photo, ts } });
    const del: OutboxEvent = { type: 'photo.delete', payload: { bucket: 'scan-photos', paths: ['u/f.jpg'] } };
    let q = queueOf(avatar(true, 1), start());
    q = enqueueItem(q, makeItem(avatar(false, 2)));
    q = enqueueItem(q, makeItem(del));
    expect(types(q)).toEqual(['photo.avatar', 'trip.start', 'photo.delete']);
    expect(q[0].payload).toEqual({ photo: false, ts: 2 });
    expect(q.filter(isPhotoEvent)).toHaveLength(2);
    const sending = enqueueItem(q, makeItem(avatar(true, 3)), q[0].id);
    expect(types(sending)).toEqual(['photo.avatar', 'trip.start', 'photo.delete', 'photo.avatar']);
  });

  it('elementy mają identyfikator UUID i licznik prób 0', () => {
    const it0 = makeItem(start(), T0);
    expect(isUuid(it0.id)).toBe(true);
    expect(it0).toMatchObject({ attempts: 0, createdAt: new Date(T0).toISOString() });
  });
});

describe('backoff i kolejność', () => {
  it('przerwy 5 s, 15 s, 60 s, potem co 2 min', () => {
    expect([1, 2, 3, 4, 9].map(backoffMs)).toEqual([5000, 15000, 60000, 120000, 120000]);
  });

  it('nieudana próba ustawia licznik, błąd i termin następnej', () => {
    let q = queueOf(start());
    q = markAttempt(q, q[0].id, 'Network request failed', T0);
    q = markAttempt(q, q[0].id, 'Network request failed', T0);
    expect(q[0]).toMatchObject({ attempts: 2, lastError: 'Network request failed', nextAttemptAt: T0 + 15000 });
  });

  it('headDue: pierwszy element dopiero po terminie (kolejne czekają za nim); ręcznie – od razu', () => {
    let q = queueOf(start(), submit('f1'));
    q = markAttempt(q, q[0].id, 'sieć', T0);
    expect(headDue(q, T0 + 1000)).toEqual({ item: null, waitMs: 4000 });
    expect(headDue(q, T0 + 5000).item?.type).toBe('trip.start');
    expect(headDue(q, T0 + 1000, true).item?.type).toBe('trip.start');
    expect(headDue([], T0)).toEqual({ item: null, waitMs: 0 });
  });

  it('lista odrzuconych ma limit (najnowsze pierwsze)', () => {
    let failed: ReturnType<typeof pushFailed> = [];
    for (let i = 0; i < FAILED_LIMIT + 5; i++) failed = pushFailed(failed, { item: makeItem(claim(`f${i}`)), error: 'x', failedAt: '' });
    expect(failed).toHaveLength(FAILED_LIMIT);
    expect(failed[0].item.type === 'find.claim' && failed[0].item.payload.findId).toBe(`f${FAILED_LIMIT + 4}`);
  });
});

describe('useOutboxStore', () => {
  const st = () => useOutboxStore.getState();
  beforeEach(() => {
    setOutboxEnabled(true);
    st().reset();
  });

  it('w trybie mock (kolejka wyłączona) nic nie trafia do kolejki', () => {
    setOutboxEnabled(false);
    st().enqueue(start());
    expect(st().items).toHaveLength(0);
  });

  it('nowe zdarzenie podnosi rewizję i budzi silnik', () => {
    const kick = jest.fn();
    const off = onOutboxKick(kick);
    const rev = outboxRevision();
    st().enqueue(start());
    st().enqueue(claim('f1'), { kick: false });
    off();
    expect(kick).toHaveBeenCalledTimes(1);
    expect(outboxRevision()).toBe(rev + 2);
    expect(types(st().items)).toEqual(['trip.start', 'find.claim']);
  });

  it('dystans wyprawy do kolejki najwyżej co minutę', () => {
    st().enqueueTripProgress('t1', 100, T0);
    st().enqueueTripProgress('t1', 300, T0 + 30_000);
    expect(st().items.map((x) => (x.type === 'trip.progress' ? x.payload.distanceM : 0))).toEqual([100]);
    st().enqueueTripProgress('t1', 900, T0 + 61_000);
    expect(st().items.map((x) => (x.type === 'trip.progress' ? x.payload.distanceM : 0))).toEqual([900]);
  });

  it('wpisy czekające na serwer: jeden na wyprawę (najnowszy na górze), usuwanie po wyprawach, drop czyści', () => {
    st().addLocalPost(localPost('t1'));
    st().addLocalPost(localPost('t2'));
    st().addLocalPost({ ...localPost('t1'), title: 'Nowy tytuł' });
    expect(st().localPosts.map((p) => `${p.tripId}:${p.title}`)).toEqual(['t1:Nowy tytuł', 't2:Wyprawa po grzyby']);
    st().removeLocalPosts(['t1', 'inna']);
    expect(st().localPosts.map((p) => p.tripId)).toEqual(['t2']);
    st().drop('nowe konto');
    expect(st().localPosts).toEqual([]);
  });

  it('fail / drop przenoszą zdarzenia do listy odrzuconych', () => {
    st().enqueue(start());
    st().enqueue(claim('f1'));
    st().fail(st().items[0].id, 'unknown_gmina');
    expect(st().failed[0]).toMatchObject({ error: 'unknown_gmina', item: { type: 'trip.start' } });
    st().drop('nowe konto');
    expect(st().items).toHaveLength(0);
    expect(st().failed.map((f) => f.error)).toEqual(['nowe konto', 'unknown_gmina']);
  });

  it('ekran Nagroda wstrzymuje przyjęcie stanu, zwolnienie budzi silnik (raz)', () => {
    const kick = jest.fn();
    const off = onOutboxKick(kick);
    const release = holdHydration();
    expect(hydrationHeld()).toBe(true);
    release();
    release();
    off();
    expect(hydrationHeld()).toBe(false);
    expect(kick).toHaveBeenCalledTimes(1);
  });
});
