# Rywalizacja – walki o okaz, pojedynki, ranking grzybiarzy (specyfikacja)

Kontrakt dla serwera (migracje `20261015*`), aplikacji (`src/types.ts` → sekcja „Rywalizacja”, `src/services/types.ts` →
`ContestService`, `DuelService`) i testów. Uczciwość rywalizacji opiera się na **podpisanym rozpoznaniu** (sekcja 1) –
bez niego żadna walka o rozmiar nie ma sensu, bo wymiary przysyłałby telefon.

## 0. Zasady wspólne

- **Liczą się tylko znaleziska zweryfikowane przez serwer.**
  - `finds.verified` – gatunek, pewność, wymiary i gmina pochodzą z rozpoznania zapisanego przez Edge Function `identify`
    (jedno rozpoznanie = jedno znalezisko).
  - `finds.size_verified` – `verified` + kapelusz zmierzony przez model przy odniesieniu skali + zdjęcie nie jest
    reprodukcją (ekran, wydruk, zdjęcie zdjęcia). Warunek walk o okaz i pojedynków „największy okaz”.
  - W telefonie te same flagi: `Find.verified`, `Find.sizeVerified` (od razu z wyniku rozpoznania, serwer potwierdza
    w `get_game_state`).
- **Dopuszczenie gracza:** `competition_eligible(uid)` – profil nieusuwany, brak statusu `review` / `banned` w `player_standing`
  i mniej niż `competition_flag_hits` (3) **incydentów** wagi 3 (wiersze flag; poza samym `rate_limited`) w
  `competition_flag_window_d` (30) dniach i po ostatnim „ok” moderatora. 3. incydent → `flag()` ustawia `review` na 30 dni
  (`updated_by = 'auto:…'`; decyzji moderatora nie nadpisuje) – docs/backend.md → „Uszczelnienia anty-cheatu”. Gracz poza
  rywalizacją widzi tablice i własne wyniki („Twoje wyniki są w weryfikacji”), ale inni go nie widzą i nie dostaje nagród.
- **Nagrody (XP)** wymagają konta zabezpieczonego e-mailem: `account_secured(uid)`. Konto anonimowe walczy i widzi swoje
  miejsce, ale nagroda = 0 (UI: „Zabezpiecz konto e-mailem, żeby odbierać nagrody” → Ustawienia → Konto).
- **Czas serwera.** Okna walk i pojedynków liczą `found_at` znaleziska (z rozpoznania – czas serwera) i dodatkowo
  `created_at` najwyżej `rivalry_queue_grace_h` (6 h) po końcu okna (kolejka offline).
- **Prywatność (bez zmian w zasadach):** nikt nie widzi lokalizacji dokładniejszej niż gmina; zasięgi publiczne (gmina,
  województwo, Polska) pokazują cudze okazy i punkty dopiero po `privacy_delay()` (24 h, `finds.visible_from` /
  `xp_events.created_at`). Znajomi (zaakceptowani, bez blokady) widzą się nawzajem na żywo – tylko liczby i gatunek, bez
  gminy. Blokady działają w obie strony (zablokowany znika z tablic, nie można go wyzwać). Gracz może ukryć się
  w rankingach i na tablicach walk (`profiles.show_in_rankings`, Ustawienia → Prywatność) – wtedy jego okazy nie walczą
  w zasięgach publicznych (tylko wśród znajomych i w pojedynkach).

## 1. Podpisane rozpoznanie (anty-cheat – migracja `20261015100000_podpisane_rozpoznanie.sql`)

- Edge Function `identify` zapisuje wynik w tabeli `recognitions` (pisze tylko service_role; klient nie ma do niej dostępu –
  wynik dostaje w odpowiedzi, flagi znaleziska w `get_game_state`, eksport – `export_recognitions`): gatunek i kandydaci,
  pewność (z bezpiecznikiem sobowtórów), `count`, `capCm`/`heightCm` (tylko przy odniesieniu skali), odniesienie skali
  (`scale_ref`: none / hand / coin / card / knife / other), ocena „reprodukcji” (ekran / wydruk / zdjęcie zdjęcia), SHA-256
  zdjęć, gmina wyliczona na serwerze z pozycji (`gmina_at`; współrzędne nie są zapisywane i nie idą do modelu; bez granic
  PRG – gmina z telefonu i flaga informacyjna), model, `expires_at` (14 dni – kolejka offline). Sama zapisuje zdjęcie główne
  do Storage (`scan-photos/{uid}/rec/{id}.jpg`, przed wywołaniem modelu; klient nie może tam pisać) – zdjęcie znaleziska
  jest z definicji tym, które widział model. Statusy: `pending` → `issued` (grzyb z atlasu, nie reprodukcja, pewność
  ≥ 60%) | `rejected` → `consumed` | `expired`.
- Odpowiedź funkcji dostaje `recognitionId` (null przy odrzuceniu; + `sizeMeasured`, `reproduction`, `expiresAt`);
  aplikacja zapisuje w znalezisku `Find.recognitionId`, `Find.verified` (= jest id) i `Find.sizeVerified` (= verified
  i `sizeMeasured` i nie reprodukcja), a `find.submit` przekazuje id (`p_recognition_id`). Reprodukcja → odrzucenie
  „To wygląda na zdjęcie ekranu albo wydruku – zrób zdjęcie prawdziwego grzyba”.
- `submit_find` z id rozpoznania bierze z rekordu serwera gatunek, rzadkość (= rzadkość gatunku), pewność, wymiary
  (waga i XXL liczone na serwerze), gminę, czas (`found_at` = czas rozpoznania) i zdjęcie; rozpoznanie zużyte →
  `consumed`. `size_verified` = kapelusz zmierzony przy skali i nie reprodukcja. Bez id – znalezisko niezweryfikowane:
  na produkcji odrzucane (`recognition_required`), przy `dev_tools` (lokalnie, wymuszony wynik skanu) dozwolone, ale
  poza wszystkimi rankingami, rekordami, percentylem, wyzwaniami i rywalizacją. Tryb mock: wymuszony wynik „z odniesieniem
  skali” symuluje podpisane rozpoznanie (`verified` + `sizeVerified` w telefonie).
- Ten sam obraz (SHA-256 pliku) drugi raz – u kogokolwiek – odmowa przed wywołaniem modelu (`image_reused`); wyjątek:
  ten sam gracz ponawia to samo zdjęcie, a wynik jest ważny albo odrzucony → zapisana odpowiedź bez modelu.
- Boty deweloperskie: ich znaleziska liczą się jak zweryfikowane (`size_verified` – gdy mają kapelusz i jeden owocnik).
- Percentyl okazu i rekordy gminy też tylko ze zweryfikowanych (rekordy – `size_verified`, bez kępek); percentyl
  k-anonimowo (≥ 5 okazów, ≥ 3 znalazców) i w progach wagi co 10%. Szczegóły: docs/backend.md → „Podpisane rozpoznanie”.

## 2. Walki o okaz (migracja `20261015110000_rywalizacja.sql`, `ContestService`)

**Harmonogram.** Tydzień pon 00:00 – nast. pon 00:00 (Europe/Warsaw). Co tydzień 3 walki:

| id | kind | tytuł | wynik |
|---|---|---|---|
| `{pon}:okaz` | relative | „Okaz tygodnia” | kapelusz / typowy kapelusz gatunku × 100 (%, 1 miejsce po przecinku) |
| `{pon}:{gatunek}` ×2 | species | „Największy {nazwa}” | kapelusz w cm (1 miejsce po przecinku) |

**Gatunki tygodnia** (to samo w SQL i TS – `src/utils/contests.ts`, test zgodności w `db:test`):
1. `month` = miesiąc daty (poniedziałek + 3 dni).
2. Kandydaci = **stała lista popularnych gatunków grzybiarzy** (kolejność ma znaczenie – rozstrzyga remisy):
   `borowik-szlachetny, podgrzybek-brunatny, czubajka-kania, kozlarz-babka, kozlarz-czerwony, maslak-zwyczajny,
   mleczaj-rydz, borowik-ceglastopory, kozlarz-pomaranczowozolty, borowik-usiatkowany, borowik-sosnowy,
   czubajka-czerwieniejaca, purchawica-olbrzymia, sarniak-dachowkowaty, gaska-nieksztaltna, gasowka-fioletowawa,
   zagiew-luskowata, pieczarka-polna, maslak-zolty, kozlarz-grabowy` – tylko te, które są w katalogu i są aktywne.
   (Pierwsza wersja brała wszystkie jadalne gatunki wg sezonu – w październiku wychodziły np. monetnica maślana i gąska
   ziemistoblaszkowa, mało kto by o nie walczył.)
3. Waga sezonu `w = season_weights[month]` (brak tablicy → 0). Sortowanie: `w` malejąco, potem pozycja na liście
   rosnąco. **Klasyka w sezonie:** gdy co najmniej 4 z pierwszych 8 kandydatów (borowik szlachetny, podgrzybek, kania,
   koźlarz babka, koźlarz czerwony, maślak, rydz, borowik ceglastopory) ma `w ≥ 0,5` – `pool` = tylko te klasyki
   (lipiec–październik walczy się o grzyby, które zbiera każdy). Inaczej (wiosna, listopad, zima) `pool` = pierwsze 6
   ze wszystkich kandydatów (np. żagiew łuskowata wiosną, gąski późną jesienią). n = długość puli. (Druga wersja bez tej
   reguły dawała w październiku gąsówkę fioletowawą i gąskę niekształtną – w pełni sezonu borowików.)
4. `h = questHash(pon + ':okaz')` (`quest_hash` w SQL); `a = h mod n`; `b = (a + 1 + (⌊h / n⌋ mod (n − 1))) mod n`.
5. Gatunki tygodnia = `pool[a]`, `pool[b]`.

**Warunki okazu** (`getContestEligibility` / `enter_contest`; powód po polsku przy odmowie):
- własne znalezisko `claimed`, `size_verified`, gatunek nie kępkowy i bez ochrony, `pieces` brak albo 1;
- `found_at` w tygodniu walki; `cap_cm ≤ find_cap_factor × typowy` (większy → nie walczy, flaga 2 – do przeglądu);
- `competition_eligible`; do walki gatunku – ten gatunek; do „Okazu tygodnia” – każdy pasujący gatunek;
- walka `open` (po końcu tygodnia zgłoszenie jeszcze do `rivalry_queue_grace_h` dla okazów z tego tygodnia).

**Zgłoszenie** jest decyzją gracza („Zgłoś okaz do walki” na ekranie Nagroda albo w dzienniku znalezisk) – wtedy zdjęcie
okazu widzą inni (polityka Storage: odczyt `scan-photos` dla zdjęć zgłoszonych, widocznych okazów). Gracz ma w walce
najwyżej jeden okaz: nowe zgłoszenie zastępuje poprzednie (UI pyta, gdy nowy jest mniejszy). Wycofanie – do końca walki.

**Tablica** (`getContestBoard`): najlepszy okaz każdego gracza, zasięgi `gmina` (gmina znaleziska), `wojewodztwo`,
`polska`, `znajomi`. Cudze okazy – po `visible_from`; własny zawsze (z `visibleFrom`, gdy inni jeszcze go nie widzą).
Remis – wcześniejszy `found_at`. Kolejność = miejsca 1..n.

**Zgłoszenia społeczności** (`reportContestEntry`): limit jak zgłoszenia wpisów; okaz z ≥ 3 zgłoszeniami od różnych
graczy → `review` (znika z tablic, autor widzi „w weryfikacji”). Moderacja (service_role): `admin_review_contest_entry`
→ przywrócenie albo odrzucenie (flaga 3 `contest_fake` dla autora).

**Rozstrzygnięcie** (leniwe – przy odczycie walk, jak `ensure_rankings_fresh`; plus dev RPC): po `resultsAt` =
koniec tygodnia + 48 h (24 h prywatności + czas na zgłoszenia). Podium (1–3) w każdym zasięgu publicznym z minimalną
liczbą uczestników: gmina ≥ 3, województwo ≥ 5, Polska ≥ 10. XP (źródło `contest`, gmina znaleziska – liczy się też do
rankingu gminy): Polska 500 / 300 / 150, województwo 250 / 150 / 75, gmina 100 / 60 / 30. Gracz dostaje w jednej walce
tylko najwyższą nagrodę (pozostałe podia – trofea z `xp = 0`). Trofea: `contest_awards` → `getTrophies`.

## 3. Pojedynki (migracja `20261015110000_rywalizacja.sql`, `DuelService`)

- Tylko zaakceptowani znajomi bez blokady. Rodzaje: `biggest` (najlepszy okaz `size_verified`, wynik jak „Okaz tygodnia”
  w %), `count` (liczba odebranych, zebranych do koszyka `verified` znalezisk), `species` (liczba różnych gatunków
  `verified`). Czas: 1, 3 albo 7 dni od przyjęcia. Zaproszenie wygasa po 48 h.
- Limity: najwyżej 3 aktywne + oczekujące pojedynki gracza, 5 nowych wyzwań na dobę, jeden aktywny/oczekujący pojedynek
  danej pary naraz.
- Wynik na żywo dla obu stron (liczby; przy `biggest` gatunek, kapelusz i zdjęcie najlepszego okazu – polityka Storage
  pozwala uczestnikowi pojedynku je czytać). Rozstrzygnięcie leniwe po `endsAt + rivalry_queue_grace_h`.
- XP (źródło `duel`): wygrana 100, remis 30 każdemu – **tylko gdy obie strony mają wynik > 0**, obie są
  `competition_eligible` i `account_secured`, i najwyżej 3 nagrodzone pojedynki gracza na tydzień oraz 1 na parę
  graczy na tydzień (przeciw farmom znajomych). Przegrana – 0.
- Doprecyzowanie (aplikacja – `src/utils/duels.ts`, mocki i opis zasad): w `biggest` okaz jak w „Okazie tygodnia” –
  gatunek nie kępkowy, bez ochrony, `pieces` brak albo 1; remis wyników (do 0,1) = remis pojedynku. Telefon liczy wynik
  sam tylko w mockach – w trybie Supabase pokazuje wynik z serwera.

## 4. Ranking grzybiarzy (migracja `20261015110000_rywalizacja.sql`, `DuelService.getPlayerRanking`)

- Punkty = suma `xp_events` w okresie (tydzień od poniedziałku / sezon od 1 stycznia – jak `ranking_period_start`)
  ze źródeł: `find` (tylko znaleziska `verified`), `challenge`, `contest`, `duel`. Bez osiągnięć, zadań, importu i admina.
- Zasięgi: `znajomi` (gracz + znajomi, na żywo), `gmina` / `wojewodztwo` (XP zdobyte w gminach zasięgu – `xp_events.gmina_id`),
  `polska`; publiczne – tylko XP starsze niż 24 h (`pendingXp` = świeże punkty gracza). Wykluczeni: ukryci
  (`show_in_rankings = false`, poza zasięgiem znajomych), poza rywalizacją, zablokowani w obie strony, usunięci.
- `setRankingVisibility(visible)` → `profiles.show_in_rankings`.

## 5. Aktywność i powiadomienia

`get_activity` dostaje nowe rodzaje (pola wspólne jak dotąd + `refId` – id pojedynku / walki, `meta` – jsonb):

| kind | actor | refId | meta |
|---|---|---|---|
| `duel_invite` | wyzywający | id pojedynku | `{ kind, days }` |
| `duel_accepted` | przeciwnik | id pojedynku | `{ kind, days }` |
| `duel_finished` | przeciwnik | id pojedynku | `{ outcome: 'won'/'lost'/'draw', xp }` |
| `contest_award` | gracz (sam) | id walki | `{ place, scope, scopeName, xp, title }` |
| `contest_overtaken` | gracz, który wyprzedził | id walki | `{ scope: 'wojewodztwo', rank, title }` (po `visible_from` jego okazu) |

W aplikacji: `ActivityKind` + `activityEntry` (src/utils/activity.ts), kategoria powiadomień „Rywalizacja”
(`rivalry`, Ustawienia → Powiadomienia). `contest_overtaken.meta.rank` aplikacja pokazuje jako **nowe miejsce gracza**
w województwie („Jesteś teraz 3. w województwie”). Tapnięcie: pojedynek → `/rywalizacja/pojedynek/{refId}`, walka →
`/rywalizacja/walka/{refId}` (id walki zakodowane – zawiera „:”). `meta` może przyjść jako jsonb albo tekst JSON.

## 6. Ekrany

- **Rywalizacja** (`app/rywalizacja/index.tsx`) – walki tygodnia (mój okaz, lider województwa, czas do końca), pojedynki
  (aktywne, wyzwania do mnie, „Wyzwij znajomego”), ranking grzybiarzy (podium + moje miejsce), trofea. Wejście: karta na
  górze zakładki Gminy, karta walki tygodnia na ekranie Wyprawa, trofea w Profilu.
- **Walka** (`app/rywalizacja/walka/[contestId].tsx`) – tablica z przełącznikiem zasięgu, zdjęcia okazów, „Zgłoś okaz”.
- **Pojedynki** (`app/rywalizacja/pojedynki.tsx`), **Pojedynek** (`app/rywalizacja/pojedynek/[duelId].tsx`), arkusz
  „Wyzwij” (znajomy → rodzaj → czas); przycisk „Wyzwij na pojedynek” w mini profilu znajomego.
- **Ranking grzybiarzy** (`app/rywalizacja/ranking.tsx`) – zasięg × okres.
- **Nagroda** – karta „Walka o okaz”: gdy okaz pasuje – miejsce, które zająłby, i „Zgłoś okaz do walki”; gdy nie – krótko,
  dlaczego (np. „Połóż obok dłoń albo monetę, a zmierzę kapelusz”).
- **Prywatność** – przełącznik „Pokazuj mnie w rankingach grzybiarzy i walkach” (Ustawienia → grupa „Prywatność”,
  `app/ustawienia/index.tsx`; `app/ustawienia/prywatnosc.tsx` to dokument „Polityka prywatności”).

Tryb mock: te same ekrany na botach (deterministycznie, offline), tryb Supabase – prawdziwe dane z pustymi stanami.

## 7. RPC (kontrakt serwer ↔ aplikacja)

Wszystkie `security definer`, `set search_path = public, extensions`, EXECUTE tylko dla `authenticated` (dev – jak inne
`dev_*`: migracja **bez** `grant execute`, funkcja sama sprawdza `dev_tools_enabled()`, EXECUTE nadaje tylko seed lokalny). Odpowiedzi to jsonb w camelCase **o kształcie typów TS** z `src/types.ts` (sekcja „Rywalizacja”), z jednym
wyjątkiem: autorzy (`author`, `user`) to surowe `author_json(uid)` – aplikacja mapuje je tak jak w feedzie
(`src/services/supabase/feedMap.ts`). Daty – `iso_ts()`. Błędy: `28000` (brak sesji), `P0001` z kodem w `message`
i polskim opisem w `detail` (np. `not_eligible`, `contest_closed`, `not_friends`, `duel_limit`, `rate_limited`),
`P0002` (`contest_not_found`, `duel_not_found`, `find_not_found`). Aplikacja (`toServiceError` w feedMap.ts) pokazuje
`detail` wprost graczowi (P0001 → 'SERVER', P0002 → 'NOT_FOUND') – opis ma być zdaniem dla gracza, nie technicznym;
w RPC rywalizacji ma pierwszeństwo przed tekstami aplikacji (np. `blocked` z feedu). Id pojedynku spoza formatu UUID →
„Nie ma takiego pojedynku” (bez zapytania; 22P02 tak samo). `create_duel`: arkusz „Wyzwij” trzyma jedno `p_duel_id` na
wybór (znajomy + rodzaj + czas), więc ponowienie po zerwanej odpowiedzi musi zwrócić ten sam pojedynek, nie `duel_limit`.

| RPC | parametry | zwraca |
|---|---|---|
| `get_contest_week` | `p_week_start date default null` (null = bieżący) | `ContestWeek` |
| `get_contest_board` | `p_contest_id text, p_scope text, p_scope_id text default null` | `ContestBoard` |
| `get_contest_eligibility` | `p_find_id uuid` | `ContestEligibility` |
| `enter_contest` | `p_find_id uuid` | `ContestEligibility` (po zgłoszeniu) |
| `withdraw_contest_entry` | `p_contest_id text` | void |
| `report_contest_entry` | `p_entry_id uuid, p_reason text default null` | void |
| `get_trophies` | `p_user uuid default null` (null = gracz) | `TrophyCase` |
| `get_duels` | – | `DuelsOverview` |
| `get_duel` | `p_duel_id uuid` | `Duel` |
| `create_duel` | `p_duel_id uuid, p_opponent uuid, p_kind text, p_days int` (id z telefonu – ponowienie nie dubluje) | `Duel` |
| `respond_duel` | `p_duel_id uuid, p_accept boolean` | `Duel` |
| `cancel_duel` | `p_duel_id uuid` | void |
| `get_player_ranking` | `p_scope text, p_period text, p_scope_id text default null` | `PlayerRanking` |
| `set_ranking_visibility` | `p_visible boolean` | void |
| `get_rivalry_status` | – | `RivalryStatus` |
| `dev_seed_rivalry` | `p_voivodeship text default null` | jsonb (podsumowanie) – boty z okazami tygodnia (widocznymi), boty-znajomi, wyzwanie bota do gracza, aktywny pojedynek |
| `dev_rivalry_act` | – | jsonb – boty przyjmują wyzwania gracza, dokładają okazy w pojedynkach, wyprzedzają gracza w walce |
| `dev_finalize_rivalry` | – | jsonb – rozstrzyga zakończone tygodnie i pojedynki od razu (bez czekania na `resultsAt`) |

`scopeId` w `get_contest_board` / `get_player_ranking`: gmina – slug gminy, województwo – nazwa (jak w `get_ranking`),
null – domyślnie gmina domowa gracza i jej województwo (bez gminy domowej: puste tablice z `scopeName` „Twoja gmina”).
Zasięg `znajomi` i `polska` ignorują `scopeId`.

**Doprecyzowania z aplikacji (walki o okaz, RC1):**
- Tytuł walki gatunku: „Największy / Największa {nazwa małą literą}” – rodzaj z pierwszego słowa nazwy (`-a` albo
  „żagiew” → „Największa”); aplikacja i tak liczy tytuł z katalogu (`contestTitle` w `src/utils/contests.ts`).
- `ContestWeek.mine[id].rank` – miejsce okazu gracza w **województwie jego znaleziska** (karta: „4. w województwie”);
  `null`, dopóki inni go nie widzą (`visibleFrom`) albo w weryfikacji. `leaders` – klucz dla każdej walki (null = brak).
- Tablica: własny okaz przed `visible_from` stoi na liście na swojej pozycji z `rank = null` (miejsca innych bez niego),
  `total` go liczy; `mine` – także spoza pierwszych 50.
- `ContestMatch.projectedRank` – wśród okazów widocznych teraz dla innych, bez okazów gracza (gmina i województwo
  znaleziska). `currentBest` – wynik innego okazu gracza zgłoszonego w tej walce (UI pyta, gdy nowy jest mniejszy).
- `report_contest_entry.p_reason` – kod z aplikacji: `reproduction` (ekran / wydruk), `wrong_species`, `other`.
- Błędy: `P0001` / `P0002` z polskim `detail` – aplikacja pokazuje `detail` wprost (`toServiceError`); `P0002`:
  `contest_not_found`, `find_not_found` (też znalezisko jeszcze nie wysłane z kolejki – Nagroda ponawia po 2 / 4 / 8 s),
  `entry_not_found`.
- Wartości kontrolne gatunków tygodnia (katalog z `src/data/mock/species.ts`): 2026-10-05 → `maslak-zwyczajny`,
  `czubajka-kania`; 2026-07-06 → `kozlarz-czerwony`, `maslak-zwyczajny`; 2026-01-05 → `kozlarz-babka`,
  `borowik-szlachetny`; 2026-04-27 → `zagiew-luskowata`, `czubajka-kania`.

**Doprecyzowania serwera (migracja `20261015110000_rywalizacja.sql`, opis: docs/backend.md → „Rywalizacja”):**
- Walki tygodnia powstają leniwie przy pierwszym odczycie (także po id walki z tygodnia ≤ bieżącego), najwyżej
  `contest_history_weeks` = 52 tygodnie wstecz (starsze → `P0002 contest_not_found`); tydzień przyszły → `P0001 invalid_week`.
  `previousWeekStart` – ostatni **rozstrzygnięty** tydzień z finalistami, wcześniejszy niż pokazany.
- `enter_contest` zgłasza znalezisko do wszystkich pasujących walk tygodnia `found_at` (okaz gatunku tygodnia – do obu);
  inny aktywny okaz gracza w tej walce → `withdrawn`. Okaz gracza w weryfikacji blokuje w tej walce zastąpienie i wycofanie
  (`entry_in_review`, gdy dotyczy wszystkich pasujących walk). Zgłoszenie i wycofanie – do końca tygodnia +
  `rivalry_queue_grace_h`; znalezisko musi dotrzeć na serwer (`created_at`) w tym samym oknie.
- Kolejność powodów odmowy: nieodebrane → odrzucone przez moderację → kępka → chroniony → kilka sztuk → niezweryfikowane →
  bez pomiaru (`size_verified`) → kapelusz > `find_cap_factor` × typowy (flaga 2 `contest_size` zapisuje
  `get_contest_eligibility`) → gracz poza rywalizacją → tydzień zamknięty (`contest_closed`).
- Widoczność okazu dla innych = `visible_from` (koniec wyprawy + 24 h), ale **najpóźniej 48 h po znalezieniu** – niezamknięta
  wyprawa nie ukrywa okazu w nieskończoność, a autor widzi stały termin `visibleFrom`. Tablica znajomych też pokazuje cudze
  okazy dopiero od tej chwili (zdjęcie i gmina są wtedy i tak publiczne); na żywo znajomi widzą się w pojedynkach i w rankingu.
- Miejsca na tablicach są **globalne** (jak na podium) – gracz w blokadzie z widzem znika z jego listy, ale nie przesuwa miejsc
  innych; `leaders` = najlepszy okaz widoczny dla gracza. Tablica rozstrzygniętej walki = migawka miejsc z rozstrzygnięcia
  (okaz, który stał się widoczny później, nie wskakuje na podium – autor widzi go bez miejsca). Ta sama reguła w rankingu
  grzybiarzy (miejsca `rank()` globalne, zablokowany tylko znika z listy, `total` – wiersze widoczne dla gracza).
- Podium gminy i województwa – tylko okazy z gminą wyznaczoną przez serwer (rozpoznanie z pozycją: `recognitions.gmina_id`
  = gmina okazu); gmina tylko z telefonu walczy w zasięgu Polski (bez farmy pustej gminy kilkoma kontami).
- Okaz walczy o podium, gdy był **publiczny** (widoczny dla innych i nieukryty – `shown_since`, odsłonięcie liczy się od nowa)
  co najmniej `contest_public_before_results_h` = 24 h przed `resultsAt` – ukrycie w rankingach albo otwarta wyprawa do
  ostatniej chwili nie omija okna zgłoszeń.
- Zgłoszenia społeczności: próg liczy różnych zgłaszających z kontem zabezpieczonym e-mailem, w rywalizacji i starszym niż
  `contest_report_min_account_days` = 7 dni (świeże / anonimowe konta nie ukryją lidera); po decyzji moderatora – tylko nowe
  zgłoszenia; po rozstrzygnięciu zgłoszenia nie są przyjmowane (`contest_closed`). Odrzucenie wyklucza znalezisko ze
  **wszystkich** walk. Okaz w weryfikacji, który stałby na podium któregoś zasięgu, **wstrzymuje rozstrzygnięcie** do decyzji
  moderatora (status `judging`), najwyżej `contest_review_max_delay_h` = 7 dni po `resultsAt` – potem walka rozstrzyga się bez
  niego.
- Pojedynki: `count` – liczba znalezisk (kępka = 1); limity „3 w toku” sprawdzane u gracza i u wyzywanego (blokady obu graczy);
  „5 wyzwań na dobę” liczy też anulowane; ponowienie `create_duel` z tym samym id zwraca zapisany pojedynek (także po wyczerpaniu
  limitu); tydzień limitów nagród = tydzień `endsAt`, liczony z księgi `duel_rewards` (usunięcie konta przeciwnika nie odnawia
  limitu); remis wyniku = remis. XP pojedynku bez gminy (ranking Polski i znajomych, nie gmin). Blokada w trakcie →
  `cancelled`, `get_duel` → `duel_not_found`. `duel_invite` w aktywności zostaje także po odpowiedzi.
- Ranking grzybiarzy: miejsca `rank()` (remis – to samo miejsce, następne pominięte). Trofea gracza ukrytego widzą tylko
  jego znajomi.
- `contest_overtaken`: serwer zapisuje **pierwszą obserwację** (przy odczycie aktywności) najnowszego gracza, który wyprzedził
  mój aktywny okaz w województwie w trwającej walce; `createdAt` = chwila obserwacji (zawsze po poprzednim odczycie – także okaz
  z późno zamkniętej wyprawy, powrót z weryfikacji, odblokowanie), `meta.rank` – moje nowe miejsce w tej chwili (stałe).
- Kody błędów (wszystkie z polskim zdaniem w `detail`): `P0001` – `invalid_scope`, `invalid_voivodeship`, `invalid_week`,
  `invalid_period`, `not_eligible`, `contest_closed`, `entry_in_review`, `invalid_entry`, `invalid_reason`, `rate_limited`,
  `invalid_duel`, `invalid_user`, `not_friends`, `duel_limit`, `duel_id_conflict`, `duel_closed`, `invalid_response`,
  `invalid_visibility`; `P0002` – `contest_not_found`, `find_not_found`, `entry_not_found`, `duel_not_found`,
  `gmina_not_found`, `user_not_found`.
- Narzędzia dev zwracają podsumowanie z polskimi kluczami (`dev_seed_rivalry` → `wojewodztwo`, `grzybiarze`, `okazy`,
  `znajomi`, `pojedynki`; `dev_rivalry_act` → `przyjęte`, `okazy`, `wyprzedzenia`; `dev_finalize_rivalry` → `walki`,
  `trofea`, `pojedynki`).
