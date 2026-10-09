-- =============================================================================
-- Rywalizacja – nowe źródła XP (osobny plik: nowej wartości enuma nie wolno użyć w tej samej transakcji)
--  · 'contest' – nagrody walk o okaz (podium gminy / województwa / Polski)
--  · 'duel'    – nagrody pojedynków ze znajomymi
-- =============================================================================

alter type public.xp_source add value if not exists 'contest';
alter type public.xp_source add value if not exists 'duel';
