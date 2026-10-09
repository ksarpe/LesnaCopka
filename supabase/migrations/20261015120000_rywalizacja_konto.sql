-- =============================================================================
-- Rywalizacja i podpisane rozpoznanie – dane gracza: usunięcie konta, eksport, reset deweloperski
--
--  · wipe_account_data: jak w 20261015100000_podpisane_rozpoznanie.sql + dane rywalizacji (wipe_rivalry_data –
--    zgłoszone okazy, zgłoszenia, trofea, pojedynki, widoczność w rankingach) i dziennik limitów reakcji (rate_events
--    z 20261015103000_uszczelnienia.sql – sprząta się po dobie, ale przy anonimizacji konta w chmurze nie powinien zostać).
--  · export_my_data: dotychczasowy eksport (przemianowany na export_my_data_v1 – bez zmian treści, bez EXECUTE dla
--    klientów) + "recognitions" (export_recognitions – rozpoznania zdjęć: wynik modelu, skróty, ścieżki zdjęć)
--    i "rivalry" (export_rivalry_data – walki, trofea, pojedynki, ustawienie widoczności). Format bez zmian
--    ("grzybobranie-export-v1"; nowe klucze są dodatkowe).
--  · dev_reset_player: jak w 20261010100000_storage.sql + rozpoznania i dane rywalizacji (świeży gracz bez starych
--    zgłoszeń i pojedynków). Pliki rozpoznań są już w storagePaths (user_storage_paths z podpisanego rozpoznania).
-- =============================================================================

create or replace function public.wipe_account_data(p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.wipe_rivalry_data(p_user);   -- zgłoszone okazy (+ zgłoszenia innych na nie), zgłoszenia, trofea, pojedynki
  perform public.wipe_game_data(p_user);      -- wyprawy (+ ślady GPS), skany (+ rozpoznania), znaleziska (+ punkty),
                                              -- księga XP, atlas, odznaki, osiągnięcia, zadania, wyzwania, wpisy (+ cudze reakcje / komentarze pod nimi)
  perform public.wipe_social_data(p_user);    -- znajomi, ukryte, zgłoszenia, własne komentarze i reakcje, moje blokady
  delete from public.user_blocks where blocked_id = p_user;
  delete from public.gmina_follows where user_id = p_user;
  delete from public.push_tokens where user_id = p_user;
  delete from public.user_terms_acceptances where user_id = p_user;
  delete from public.dev_bot_activity where user_id = p_user;
  delete from public.anti_cheat_flags where user_id = p_user;
  delete from public.identify_calls where user_id = p_user;
  delete from public.recognitions where user_id = p_user;    -- + recognition_images (cascade)
  delete from public.rate_events where user_id = p_user;
  delete from public.player_standing where user_id = p_user;
end $$;

-- Eksport: dotychczasowa treść bez zmian pod nową nazwą (wewnętrzna) + nowe sekcje.
alter function public.export_my_data() rename to export_my_data_v1;
revoke all on function public.export_my_data_v1() from public, anon, authenticated;

create function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return public.export_my_data_v1() || jsonb_build_object(
    'recognitions', public.export_recognitions(v_uid),
    'rivalry', public.export_rivalry_data(v_uid)
  );
end $$;

-- Świeży gracz (panel /dev): jak w 20261010100000_storage.sql + rozpoznania i dane rywalizacji.
create or replace function public.dev_reset_player() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_paths jsonb;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.dev_tools_enabled() then raise exception 'dev_tools_disabled' using errcode = 'P0001'; end if;
  perform 1 from public.profiles where id = v_uid for update;
  v_paths := public.user_storage_paths(v_uid);             -- + zdjęcia rozpoznań (rec/)
  perform public.wipe_rivalry_data(v_uid);
  perform public.wipe_game_data(v_uid);                    -- znaleziska (photo_path) i wpisy (cover_path)
  perform public.wipe_social_data(v_uid);
  delete from public.recognitions where user_id = v_uid;
  update public.profiles set avatar_path = null where id = v_uid and avatar_path is not null;
  return public.get_game_state() || jsonb_build_object('storagePaths', v_paths);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uprawnienia: export_my_data – nowa funkcja (odbieramy domyślne, nadajemy graczom jak dotąd); wipe_account_data
-- i dev_reset_player (create or replace) zachowują dotychczasowe – dev_reset_player bez EXECUTE w migracji
-- (nadaje je tylko seed lokalny – 20261015103000_uszczelnienia.sql).
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.export_my_data() from public, anon, authenticated;
grant execute on function public.export_my_data() to authenticated;
