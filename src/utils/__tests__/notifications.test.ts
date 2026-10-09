import { describe, expect, it } from '@jest/globals';

import { AUTHORS } from '../../data/mock/users';
import {
  atHour,
  dayKey,
  DEFAULT_NOTIF_PREFS,
  NOTIF_CATEGORIES,
  groupByDay,
  lastWeeklyOccurrence,
  mockSocialNotifications,
  streakReminderPlan,
  WEEKLY_SUMMARY,
} from '../notifications';

// Wtorek 6 października 2026 (czas lokalny).
const at = (h: number, m = 0, day = 6) => new Date(2026, 9, day, h, m);

describe('streakReminderPlan', () => {
  const base = { hour: 18, lastActiveDate: '2026-10-05', streakDays: 3 };

  it('bez aktywności przed godziną przypomnienia – zaczyna od dziś, 7 dni', () => {
    const plan = streakReminderPlan({ ...base, now: at(10), activeToday: false });
    expect(plan).toHaveLength(7);
    expect(plan[0].key).toBe('streak.2026-10-06');
    expect(new Date(plan[0].dueAt).getHours()).toBe(18);
    // Wczoraj była aktywność → dziś seria jeszcze żyje.
    expect(plan[0].title).toBe('Nie przerwij serii 3 dni!');
    expect(new Set(plan.map((p) => p.key)).size).toBe(7);
  });

  it('po godzinie przypomnienia dzisiejszego nie planuje', () => {
    const plan = streakReminderPlan({ ...base, now: at(19), activeToday: false });
    expect(plan[0].key).toBe('streak.2026-10-07');
    expect(plan).toHaveLength(7);
  });

  it('aktywność dziś – przypomnienie dopiero jutro, z bieżącą serią', () => {
    const plan = streakReminderPlan({ ...base, lastActiveDate: '2026-10-06', now: at(9), activeToday: true });
    expect(plan[0].key).toBe('streak.2026-10-07');
    expect(plan[0].title).toBe('Nie przerwij serii 3 dni!');
    expect(plan[1].title).not.toContain('serii');
  });

  it('seria 1 dnia – bez komunikatu o serii', () => {
    const plan = streakReminderPlan({ ...base, streakDays: 1, now: at(10), activeToday: false });
    expect(plan.every((p) => !p.title.includes('serii'))).toBe(true);
  });
});

describe('lastWeeklyOccurrence', () => {
  const { weekday, hour } = WEEKLY_SUMMARY;

  it('wtorek → poprzednia niedziela 19:00', () => {
    const d = lastWeeklyOccurrence(at(10), weekday, hour);
    expect(dayKey(d)).toBe('2026-10-04');
    expect(d.getHours()).toBe(19);
  });

  it('niedziela przed 19:00 → niedziela tydzień wcześniej; o 19:00 → ta sama', () => {
    expect(dayKey(lastWeeklyOccurrence(at(18, 59, 11), weekday, hour))).toBe('2026-10-04');
    expect(dayKey(lastWeeklyOccurrence(at(19, 0, 11), weekday, hour))).toBe('2026-10-11');
  });
});

describe('atHour', () => {
  it('przechodzi przez koniec miesiąca', () => {
    expect(dayKey(atHour(new Date(2026, 9, 31, 12), 1, 8))).toBe('2026-11-01');
  });
});

describe('groupByDay', () => {
  it('dzieli na dziś i wcześniej, od najnowszych', () => {
    const items = [
      { id: 'a', createdAt: at(8).toISOString() },
      { id: 'b', createdAt: at(20, 0, 5).toISOString() },
      { id: 'c', createdAt: at(11).toISOString() },
    ];
    const g = groupByDay(items, at(12));
    expect(g.today.map((i) => i.id)).toEqual(['c', 'a']);
    expect(g.earlier.map((i) => i.id)).toEqual(['b']);
  });
});

describe('mockSocialNotifications', () => {
  const friends = Object.values(AUTHORS);
  const visibleFrom = at(12).getTime();

  it('deterministyczne, po visibleFrom, od trzech różnych osób', () => {
    const a = mockSocialNotifications('post_abc', visibleFrom, friends);
    const b = mockSocialNotifications('post_abc', visibleFrom, friends);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(a.every((n) => n.dueAt > visibleFrom && n.kind === 'social')).toBe(true);
    const names = a.map((n) => friends.find((f) => n.title.includes(f.name))?.id);
    expect(new Set(names).size).toBe(3);
  });

  it('za mało znajomych – brak reakcji', () => {
    expect(mockSocialNotifications('post_abc', visibleFrom, friends.slice(0, 2))).toEqual([]);
  });
});

describe('kategorie powiadomień', () => {
  it('„Rywalizacja” – osobny przełącznik, domyślnie włączony; każda kategoria ma wartość domyślną', () => {
    const ids = NOTIF_CATEGORIES.map((c) => c.id);
    expect(ids).toContain('rivalry');
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(DEFAULT_NOTIF_PREFS).sort()).toEqual([...ids].sort());
    expect(DEFAULT_NOTIF_PREFS.rivalry).toBe(true);
    expect(NOTIF_CATEGORIES.find((c) => c.id === 'rivalry')?.label).toBe('Rywalizacja');
  });
});
