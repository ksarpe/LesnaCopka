# Grzybobranie – klikalny prototyp (React Native / Expo)

Frontend-only prototyp zgamifikowanego grzybobrania. Dane gry są mockami, a postęp skanu,
rozpoznawanie AI i publikacja są **symulowane**. **Prawdziwe**: lokalizacja (GPS urządzenia,
gmina wykrywana na telefonie z granic PRG, mapa okolicy z lasami – także offline, patrz [Lokalizacja i mapa okolicy](#lokalizacja-i-mapa-okolicy)
i [Mapy offline](#mapy-offline)),
dystans i trasa wyprawy z GPS, podgląd aparatu i zdjęcie znaleziska, avatar ze zdjęcia oraz lokalne
powiadomienia (patrz [Aparat, profil, powiadomienia, społeczność](#aparat-profil-powiadomienia-społeczność)). Wygląd odwzorowuje 1:1 plik
`Grzybobranie UI v2.dc.html` (9 ekranów, ramka iPhone 390×844).

- Expo SDK 57 · React Native 0.86 · TypeScript (strict) · expo-router
- react-native-reanimated 4 · gesture-handler · react-native-svg · expo-linear-gradient
- zustand (+ persist w AsyncStorage) · expo-haptics · fonty Baloo 2 / Nunito Sans / Material Symbols Rounded
- expo-location · expo-camera · expo-image-picker / expo-image-manipulator · expo-notifications · expo-file-system

## Uruchomienie

```bash
npm install
```

```bash
npx expo start
```

Następnie zeskanuj QR kod w **Expo Go** (iOS, SDK 57) albo naciśnij `i` (symulator iOS) / `w` (przeglądarka).
Android uruchamia się tak samo (`a`), ale nie był dopieszczany.

Kontrole jakości:

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run lint
```

## Pełna pętla do przeklikania

Pierwsze uruchomienie z serwerem (albo scenariusz „Nowy użytkownik” w panelu `/dev`) zaczyna się od **onboardingu**
(powitanie, bezpieczeństwo, regulamin, profil, gmina domowa, uprawnienia – patrz [Konto, onboarding i Twoje dane](#konto-onboarding-i-twoje-dane));
w trybie mock startowy gracz demo ma go już za sobą.

Start → **Rozpocznij grzybobranie** → **Skanuj grzyba** (zgoda na aparat, podgląd na żywo) → skan 360° dochodzi do 100% →
spust ✦ (zdjęcie) → „Analizuję…” → **Analiza** → **Odbierz nagrodę** → **Nagroda** (XP, pasek poziomu, odznaka) →
**Zbieram dalej** → (powtórz) → **Zakończ wyprawę** → potwierdzenie → **Podsumowanie** (trasa na mapie) → przełącznik trasy →
**Opublikuj w feedzie** → wpis na górze **Feedu** z adnotacją „widoczne za 24 h” → komentarze, „Darz grzyb!”.

Pierwszy skan zawsze zwraca borowika szlachetnego XXL 410 g – dokładnie scenariusz z makiety
(+250 XP, odznaka „Król Puszczy”). Kolejne skany losują gatunki deterministycznie (stały seed) – ważone rzadkością i sezonem bieżącego miesiąca
(patrz [Katalog gatunków](#katalog-gatunków)).

## Mapa ekranów

| # | Ekran | Plik | Prezentacja |
|---|---|---|---|
| 01 | Start / aktywna wyprawa | `app/(tabs)/index.tsx` | zakładka „Wyprawa” |
| 02 | Skan 360° | `app/scan.tsx` | modal fullscreen, fade |
| 03 | Analiza (+ niska pewność, gatunek trujący) | `app/analysis/[findId].tsx` | stack push |
| 04 | Nagroda | `app/reward/[findId].tsx` | modal fullscreen, fade |
| 05 | Podsumowanie wyprawy | `app/summary/[tripId].tsx` | stack push |
| 06 | Mapa gmin | `app/(tabs)/gminy/index.tsx` | zakładka „Gminy” |
| 07 | Szczegóły gminy | `app/(tabs)/gminy/[id].tsx` | push w zakładce (bez tab bara) |
| 08 | Profil i atlas | `app/(tabs)/profil.tsx` | zakładka „Profil” |
| 09 | Feed | `app/(tabs)/feed.tsx` | zakładka „Feed” |
| – | Karta gatunku (atlas, tylko odczyt) | `app/species/[speciesId].tsx` | stack push |
| – | Atlas gatunków (pełny, z filtrami) | `app/atlas.tsx` | stack push z Profilu („Zobacz wszystko” albo kafel „gatunki”) |
| – | Osiągnięcia (wszystkie, z zablokowanymi) | `app/osiagniecia.tsx` | stack push z Profilu („Zobacz wszystko”) |
| – | Historia wypraw (miesiące, sumy sezonu, tap → Podsumowanie) | `app/wyprawy.tsx` | stack push z Profilu (kafel „wyprawy”) |
| – | Dziennik znalezisk (filtry, wyszukiwarka, sortowanie, tap → karta gatunku) | `app/znaleziska.tsx` | stack push z Profilu (kafel „grzybów”) |
| – | Ustawienia | `app/ustawienia/index.tsx` | stack push z Profilu (⚙) |
| – | Edycja profilu (avatar, imię, nick, „O mnie”) | `app/ustawienia/profil.tsx` | stack push (tap w avatar w Profilu) |
| – | Gmina domowa (wyszukiwarka 2479 gmin) | `app/ustawienia/gmina.tsx` | stack push z Ustawień |
| – | Ustawienia powiadomień | `app/ustawienia/powiadomienia.tsx` | stack push z Ustawień |
| – | Centrum powiadomień | `app/powiadomienia.tsx` | stack push (dzwonek w Feedzie) |
| – | Komentarze wpisu | `app/komentarze/[postId].tsx` | stack push z Feedu |
| – | Znajomi i zaproszenia | `app/znajomi.tsx` | stack push z Feedu (ikona „dodaj znajomego”) |
| – | Mapa okolicy (pełny ekran) | `app/mapa.tsx` | modal fullscreen, fade (tap w mapę na karcie „Wykryto region”) |
| – | Mapy offline (pobrane obszary, miejsce, pamięć podręczna) | `app/ustawienia/mapy-offline.tsx` | stack push z Ustawień (Aplikacja → „Mapy offline”) i z arkusza na mapie |
| – | Regulamin / Polityka prywatności (szkice) | `app/ustawienia/regulamin.tsx`, `app/ustawienia/prywatnosc.tsx` | stack push z Ustawień („Informacje prawne”) i z onboardingu |
| – | Onboarding (powitanie, bezpieczeństwo, regulamin, profil, gmina domowa, uprawnienia; logowanie kodem) | `app/onboarding.tsx` | zamiast zakładek, dopóki nie skończony (`Stack.Protected` w `app/_layout.tsx`) |
| – | Konto i logowanie (e-mail z kodem, logowanie na inne konto, wylogowanie) | `app/ustawienia/konto.tsx` | stack push z Ustawień („Konto i logowanie”) |
| – | Usuń konto (skutki, potwierdzenie nickiem) | `app/ustawienia/usun-konto.tsx` | stack push z Ustawień („Usuń konto”) |
| – | Zablokowani („Odblokuj”) | `app/ustawienia/zablokowani.tsx` | stack push z Ustawień (Prywatność → „Zablokowani”) |
| – | Ekran błędu („Coś poszło nie tak”) | `src/components/ErrorScreen.tsx` (`ErrorBoundary` w `app/_layout.tsx`) | zamiast ekranu, który rzucił błąd |
| – | Panel symulacji | `app/dev.tsx` | modal (tylko z narzędziami dev) |

Panel symulacji: **przytrzymaj avatar** na ekranie Start albo wejdź w Profil → ⚙ → „Panel symulacji (dev)”.
Dostępny tylko z narzędziami deweloperskimi – zawsze w `npx expo start`, w buildzie tylko z `EXPO_PUBLIC_DEV_TOOLS=1`
(patrz [Wydanie](#wydanie)); bez nich nie ma wiersza w Ustawieniach ani przytrzymania avatara, a `/dev` przekierowuje na start.
Pozwala przełączyć źródło pozycji (GPS urządzenia / symulacja: wybrana gmina, słaby GPS ±1,5 km,
punkt za granicą) i aparatu (aparat urządzenia / symulacja), wyłączyć GPS / sieć, ustawić zgody (lokalizacja, aparat),
wymusić wynik skanu (gatunek, rzadkość, XXL, trujący, niska pewność), przyspieszyć czas ×10,
dodać dystans i XP, „Spacer 0,5 / 2 / 5 km” (dystans + trasa do Podsumowania), odblokować odznakę, odkryć losowe
gatunki (test osiągnięć), dodać przykładowe / testowe powiadomienia, wczytać scenariusze (m.in. stany z makiety)
i zresetować wszystko.

Na webie (tylko dev) działają też linki-scenariusze, np. `http://localhost:8081/?scenario=designReward`
albo `/?scenario=designAnalysis&low=1` – lista w `src/dev/devLinks.ts`. Onboarding: `?scenario=newUser` (nowy gracz →
onboarding), `&onboarding=0` go pomija, `/?onboarding=1` pokazuje go na bieżącym stanie; na ekranie onboardingu
z narzędziami dev jest „Pomiń (dev)”, a w panelu `/dev` → Scenariusze „Onboarding (bez resetu)”. Linki domyślnie używają
symulowanej pozycji i aparatu (powtarzalne zrzuty); prawdziwy GPS: `&src=device`, prawdziwy aparat: `&camSrc=device`.

## Struktura

```
app/                      trasy expo-router (ekrany powyżej)
src/theme/tokens.ts       kolory, rzadkości, typografia, promienie, cienie
src/components/           Button3D/Press3D, Card, Pill, RarityPill, ProgressBar, ProgressRing, Placeholder,
                          TabBar, IconButton, SegmentedControl, Badge, Icon, Toggle, Skeleton, UiHost (toast/dialog)…
src/types.ts              modele: Species, Find, Trip, Gmina, User, Post, Badge, Quest, Rarity…
src/services/types.ts     interfejsy serwisów (kontrakt warstwy danych)
src/services/mock/        implementacje mock + „baza” mocków (posty)
src/services/live/        prawdziwe: lokalizacja i śledzenie GPS (expo-location + gmina z PRG), mapa okolicy (kafle MVT),
                          kafle na dysku (tileStore.ts + tileBackend.ts / .web.ts – mapy offline), aparat i zdjęcia
                          znalezisk, zdjęcie profilowe, powiadomienia lokalne
src/geo/                  wykrywanie gminy offline, geometria, Web Mercator, filtr śladu GPS i przybliżona trasa
                          (track.ts), województwa, kafle (tiles.ts: zakresy, gmina → kafle, LRU) i dekoder MVT (mvt.ts)
                          – czyste funkcje, testy w src/geo/__tests__
assets/geo/               granice gmin (indeks + 16 paczek województw) – generowane przez npm run geo:build
scripts/geo/              build-gminy.ts (PRG + GUS → assets/geo), verify-gminy.ts (kontrola jakości)
src/data/mock/            dane: gatunki, gminy, użytkownicy, feed, odznaki/zadania
src/store/                useUserStore, useTripStore, useSimStore, usePrefsStore, useNotificationStore (persist),
                          useTrackStore (ślad wyprawy – tylko w pamięci) + game.ts (akcje gry), notify.ts (powiadomienia),
                          useOutboxStore (kolejka zdarzeń gry do serwera – tylko tryb Supabase), useOfflineMapsStore
                          (obszary map offline i ich pobieranie)
src/services/supabase/    konto anonimowe, słowniki z bazy, synchronizacja gry (sync.ts, gameState.ts), feed i znajomi
                          (feed.ts), rankingi i statystyki gmin (stats.ts), zdjęcia w Storage (photos.ts, storage.ts,
                          storagePaths.ts, remotePhotos.ts)
src/utils/xp.ts           logika XP/poziomów – czyste funkcje, testy w src/utils/__tests__
src/utils/achievements.ts definicje i liczenie osiągnięć z atlasu – czyste funkcje, testy w src/utils/__tests__
src/utils/history.ts      historia wypraw i dziennik znalezisk (miesiące, sumy, filtry, sortowanie) – czyste funkcje
src/config.ts             flagi wydania (DEV_TOOLS – narzędzia deweloperskie)
src/utils/reportError.ts  zgłaszanie błędów (ekran błędu, globalne błędy JS, odrzucone obietnice) – miejsce na Sentry
src/data/legal.ts         regulamin i polityka prywatności (szkice) → ekrany Ustawień i docs/legal/*.md (npm run legal:md);
                          LEGAL_VERSION (wersja akceptowana w onboardingu), SAFETY_NOTICE / SAFETY_RULES (bezpieczeństwo)
src/store/account.ts      konto: wylogowanie, logowanie kodem, usunięcie konta, eksport danych, czyszczenie telefonu
src/store/onboarding.ts   koniec onboardingu (profil + regulamin + kolejka); src/utils/onboarding.ts – kroki i walidacja
src/store/block.ts        blokowanie grzybiarzy (potwierdzenie, toast, odświeżenie feedu)
src/services/supabase/account.ts  e-mail z kodem OTP, switchAccount (sync.ts), usunięcie konta, export_my_data
eas.json                  profile buildów EAS: development, preview, production
```

## Mock → API: gdzie podmienić

Ekrany korzystają wyłącznie z interfejsów z `src/services/types.ts` przez `useServices()`:

| Interfejs | Metody |
|---|---|
| `LocationService` | `getCurrentRegion(previous)` → gmina + pozycja, `watchDistance(cb(deltaKm, point?), { resumeFrom })` |
| `MapService` | `getAreaMap({ lat, lon, radiusM, gminaTeryt }, { offline })` → lasy, woda, drogi, granica gminy, odległość do lasu (kafle z telefonu, potem z sieci); `fetchTile(x, y)` – surowy kafel do map offline |
| `ScanService` | `startScan(cb, { signal })`, `capturePartial(parts)` |
| `IdentifyService` | `identify(scan)` → gatunek, pewność, wymiary, sobowtóry |
| `StatsService` | `getGminaStats(id)`, `getRanking(period, { voivodeship })`, `getSpeciesPercentile(speciesId, gminaId, size)` |
| `FeedService` | `getFeed(scope)`, `loadNewer(scope)`, `publishTrip(trip, { hideRoute })`, `toggleReaction(postId)`, `getPost`, `getComments` / `addComment` / `deleteComment`, `hidePost` / `unhidePosts` / `getHiddenPosts`, `reportPost`, `getFriends` / `getFriendsOverview` / `searchUsers` / `getUser` / `getUserByHandle` / `addFriend` / `respondFriendRequest` / `removeFriend`, `blockUser` / `unblockUser` / `getBlockedUsers`, opcjonalnie `getActivity(since)` (prawdziwa aktywność → powiadomienia) |
| `CatalogService` | słowniki: gatunki, gminy, odznaki, pula zadań (dzienne i tygodniowe), liczba gatunków |
| `PermissionService` | `get(kind)`, `request(kind)`, opcjonalnie `refresh(kind)` / `openSettings(kind)` – prawdziwe zgody (lokalizacja, aparat) albo symulowany prompt (tryb symulacji) |

Podmiana: napisz implementację `Services` (np. `src/services/api/index.ts` na `fetch`/`expo-location`/
`expo-camera`) i przekaż ją w `app/_layout.tsx`:

```tsx
<ServicesProvider value={apiServices}>
```

`Services.dev` (reset danych mocków) jest opcjonalne – API może go nie implementować.
Stan startowy gracza (`src/store/useUserStore.ts`) jest seedowany z `src/data/mock/users.ts`.
Z backendem Supabase gra zostaje liczona w telefonie (`src/store/game.ts`), a serwer ją powtarza
i nadpisuje swoim stanem – patrz [Backend (Supabase)](#backend-supabase).

## Katalog gatunków

**120 gatunków występujących w Polsce** (`src/data/mock/species.ts`, w bazie z `npm run db:seed`): 55 pospolitych,
35 rzadkich, 20 epickich, 10 legendarnych; 70 jadalnych, 20 niejadalnych, 21 trujących, 9 śmiertelnie trujących.
Atlas pokazuje cały katalog (`TOTAL_SPECIES` = długość katalogu). Każdy gatunek ma nazwę polską i aktualną łacińską,
jadalność (konserwatywnie – wątpliwe jako trujące, „tylko po ugotowaniu” z ostrzeżeniem w opisie), siedliska
(`habitats`), typowe wymiary, sezon (`seasonWeights` – 12 wag I–XII, szczyt = 1), opis z cechami rozpoznawczymi
i 0–3 sobowtórów (najgroźniejsze pomyłki: kania ↔ muchomor zielonawy, smardz ↔ piestrzenica, opieńka ↔ hełmówka
jadowita i maślanka wiązkowa…). Źródła i rozbieżności między nimi: [docs/species-sources.md](docs/species-sources.md).

- **Gatunki chronione** (`protection: 'scisla' | 'czesciowa'` – rozporządzenie Ministra Środowiska z 9 października
  2014 r. w sprawie ochrony gatunkowej grzybów, Dz.U. 2014 poz. 1408; 24 gatunki, m.in. smardze, soplówki, borowik
  królewski i szatański, żagwica listkowata): **tylko zdjęcie**, jak trujące – nie trafiają do koszyka, ½ bazowych XP
  i bonus **„Zostawiony w lesie – gatunek chroniony” +30 XP** (`computeFindXp`, serwer: `claim_find`). Analiza i karta
  gatunku pokazują zielony baner „Gatunek chroniony – nie zbieraj, zrób tylko zdjęcie”, przycisk „Zapisz w atlasie”.
- **Karta gatunku**: opis, siedliska, ochrona, lista sobowtórów (najgroźniejsze najpierw – `speciesLookalikes`
  w `src/utils/species.ts`), sezon i występowanie, rekordy.
- **Mock rozpoznawania** losuje gatunek ważony rzadkością × sezonem bieżącego miesiąca
  (`src/services/mock/identifyPick.ts`) – w październiku wypadają jesienne gatunki, w kwietniu smardze; pierwszy skan
  to nadal borowik XXL 410 g z makiety.
- Testy: `src/data/__tests__/species.test.ts` (integralność katalogu), `src/utils/__tests__/species.test.ts` (XP
  chronionych), `src/services/mock/__tests__/identifyPick.test.ts` (sezonowość), `npm run db:test` (serwer).

## Osiągnięcia, poziomy i zadania (progresja)

Profil: **Atlas gatunków** pokazuje jeden wiersz (ostatnio odkryte) i „Zobacz wszystko” → pełny atlas
z podsumowaniem rzadkości i filtrami. Niżej **Osiągnięcia x / Y** – trzy najbliżej następnego stopnia
i „Zobacz wszystko” → wszystkie, w sekcjach, z zablokowanymi i sekretnymi („???”).

- **67 osiągnięć, 249 stopni** (Y liczy stopnie) w 11 kategoriach: Kolekcja (6: gatunki, jadalne, rzadkie, epickie,
  legendy, niejadalne), Zestawy gatunków (14: klasyczne zestawy + rodziny z katalogu – borowikowate, gołąbkowate,
  muchomory, maślaki, gąski – i „Rurkowe na patelnię”), Bezpieczeństwo (5: trujące, śmiertelne, sobowtóry, zdjęcia
  trujących, „Atlas trucizn”), Okazy (9), **Wyprawy** (6: liczba, km, najdłuższa trasa i czas, starty przed 6:00,
  znaleziska na jednej wyprawie), **Odkrywca** (4: gminy, województwa, kompleksy leśne, znaleziska poza gminą domową),
  **Pory roku** (6: miesiące – „Grzybiarz całoroczny” 12/12, cztery pory roku, wiosna/lato/jesień/zima),
  **Seria** (2: 3/7/30/100/365 dni z rzędu, dni w lesie), **Społeczność** (5: reakcje dane i otrzymane, komentarze,
  znajomi, publikacje), **Wyzwania** (3: wyzwania gmin, zadania dnia, zadania tygodnia), Sekretne (7: m.in. ten sam
  gatunek 3× z rzędu, znalezisko o 11:11, 13 trujących w piątki 13., nocny grzybiarz, Wigilia).
- Stopnie: brąz → srebro → złoto → platyna → **diament** (4 stopnie: bez diamentu; 3: brąz–złoto; 2: srebro, złoto;
  1: złoto). Diament ma lodowy gradient z odblaskiem (`DiamondDisc` w `src/components/Achievement.tsx`, kolory
  `tiers.diament` / `diamondGradient` w tokenach). Rodziny z katalogu mają progi ¼, ½, ¾ i całość – rosną z katalogiem.
- **Bilans XP** (`XP_LADDERS`, nagroda wg medalu): brąz/srebro – pierwsze tygodnie, złoto – sezon, platyna i diament –
  1–3 sezony regularnego grzybiarza (≈ 50 wypraw, 300 km, 750 znalezisk na sezon); diament 1000–2500 XP. Wszystkie
  stopnie razem ≈ 144 tys. XP (40 osiągnięć z diamentem) – ok. ¼ XP aktywnego gracza (reszta: znaleziska,
  zadania), więc to nagroda, nie farma.
- Postęp liczy się na bieżąco z atlasu i **liczników** (`useUserStore.counters`, `src/utils/counters.ts`: wyprawy, km,
  gminy, województwa, miesiące, serie, reakcje…), store pamięta tylko nagrodzone stopnie (`useUserStore.achievements`).
  Stopnie zdobyte znaleziskiem pokazuje ekran Nagroda, a XP wpada po „Zbieram dalej”; z wypraw, publikacji, reakcji
  i znajomych – od razu (toast). Gracz startowy i zapis sprzed tej wersji (migracja v5) dostają osiągnięte już stopnie
  bez wypłaty XP (`mergeSeedAwarded`).
- **Poziomy**: krzywa bez zmian (+200 XP/poziom; Lv 50 ≈ 255 tys. XP, Lv 100 ≈ 1 mln). Tytuły co 5 poziomów do 100
  (`LEVEL_TITLES`, 21 tytułów: … Strażnik Puszczy 20, Mistrz Grzybobrania 25, Mędrzec Lasu 50, Król Borowików 80,
  Legenda Lasu 90, Arcymistrz Grzybobrania 100). Odznaka poziomu w profilu: złota od Lv 50, diamentowa od Lv 100.
- **Odznaki** (5 z makiety) z liczników, tak samo w obu trybach: Ranny ptaszek (start przed 6:00), 100 km, Seria 7 dni,
  Łowca Legend, Król Puszczy – przyznawane przy starcie wyprawy, dystansie i znalezisku (`src/utils/badges.ts`).
- Nowe osiągnięcie = wpis w `ACHIEVEMENTS` (`src/utils/achievements.ts`) z metryką, progami i celem, potem
  `npm run db:seed`; nowa metryka licznika – pole w `PlayerCounters` + wartość enumu i klucz w `player_metrics()` (SQL).

### Zadania dnia i tygodnia

Start: karta „Zadania dnia” (3 zadania jak w makiecie) i pod nią mały nagłówek **„Tygodniowe”** (3 zadania, do
niedzieli). Pula: 38 szablonów (`QUEST_POOL` w `src/data/mock/game.ts`) – 25 dziennych (skany, rzadki/epicki okaz,
dystans, ponad godzinę w lesie, nowy gatunek w atlasie, zdjęcie trującego, grzyb poza gminą domową, XXL, jadalne,
różne gatunki, publikacja, „Darz grzyb!” 3 wyprawom, start przed 7:00, sezonowe „Znajdź borowika / kurki / kanię /
rydza / opieńki / podgrzybka / smardza” – tylko w miesiącach z `seasonWeights` ≥ 0,5) i 13 tygodniowych (większe
cele i XP). Losowanie (`selectQuests`, `src/utils/quests.ts`) jest deterministyczne z (id gracza, dzień / poniedziałek):
bez dwóch zadań tego samego rodzaju, dziennie co najmniej jedno łatwe. Serwer (`quests_for`) losuje identycznie, więc
oba tryby pokazują te same zadania. Scenariusze dev-linków (`?scenario=start|designActive|…`) przypinają zadania
z makiety (Zeskanuj 5 · Znajdź rzadki · Przejdź 5 km) bez tygodniowych.

- Supabase: słownik w `achievements`, `achievement_tiers`, `achievement_set_species`, `quest_templates` (seed z definicji
  aplikacji), serwer liczy postęp i nagradza stopnie sam (`20261006100000_achievements.sql` +
  `20261013110000_progression.sql`); po synchronizacji aplikacja przyjmuje nagrodzone stopnie, liczniki
  (`get_game_state().counters`) i wylosowane zadania – szczegóły w [docs/backend.md](docs/backend.md#osiągnięcia).

## Lokalizacja i mapa okolicy

Karta „Wykryto region” na ekranie Start:

1. **Pozycja** – `expo-location` (działa w Expo Go i na webie; web wymaga `localhost` albo https).
   Ostatnia znana pozycja (≤ 60 s, ≤ 100 m) daje kartę od razu, inaczej świeży odczyt (limit 12 s).
   Odświeżenie po powrocie aplikacji na pierwszy plan – bez ciągłego śledzenia.
2. **Gmina – offline, na urządzeniu.** Granice wszystkich 2479 gmin z PRG (GUGiK), uproszczone do 15 m
   z zachowaniem topologii: indeks 250 KB + paczka województwa 150–510 KB (łącznie 4,7 MB w `assets/geo`).
   Bbox → punkt-w-wielokącie; przy granicy histereza (nie przeskakujemy do sąsiedniej gminy, dopóki
   punkt mieści się w dokładności GPS, min. 30 m); do 200 m za granicą państwa – najbliższa gmina; dalej „Jesteś poza Polską”.
   Kontrola (`npm run geo:verify`): 20 000 losowych punktów – 0,03% błędów; punkty ≤ 60 m od granicy – błędy
   wyłącznie ≤ 10 m od prawdziwej granicy; 150/150 zgodnych z ULDK GUGiK.
3. **Mapa okolicy** – wektorowe kafle z13 (schemat OpenMapTiles, dane OSM) z OpenFreeMap, rysowane w SVG
   w stylu aplikacji: lasy, woda, drogi i drogi leśne, granica gminy (przerywana), halo dokładności GPS.
   Z tych samych kafli: „Jesteś w lesie” / „Las 400 m stąd” (promień 1,6 km). Lesistość gminy – GUS BDL.
   Kafle najpierw z telefonu (mapy offline i pamięć podręczna oglądanych okolic), potem z sieci – patrz
   [Mapy offline](#mapy-offline). Bez sieci gmina i lesistość działają zawsze, mapa – gdy jej kafle są na telefonie;
   inaczej placeholder „mapa niedostępna offline” (raz z podpowiedzią „Pobierz mapę na offline, zanim wyjdziesz do lasu”).
   Tap w mapę (albo przycisk w rogu) otwiera **mapę na pełnym ekranie** (`app/mapa.tsx`): promień 4 km (9–16 kafli,
   wspólne z kartą z pamięci podręcznej), szczypanie / przesuwanie z bezwładnością / podwójne tapnięcie, na webie
   kółko myszy; przybliżenie 1×–6× (do ~1,5 m/px), przesuwanie w granicach pobranych danych. Lasy z brzegiem
   i znacznikami drzew, kropkowana kreska do najbliższego lasu, granica i nazwa gminy, legenda z podpisem OSM;
   przycisk „Pobierz na offline” w prawym górnym rogu; bez sieci i bez kafli na telefonie – karta „Mapa niedostępna
   offline” z ponowieniem. Web (dev): `/?scenario=start&path=/mapa`.
   W trakcie gestu skalowany jest gotowy obraz, po geście ścieżki SVG liczą się od nowa (ostre wektory) –
   szczegóły w `src/components/ZoomableAreaMap.tsx`. Rzutowanie wspólne z kartą: `src/geo/areaMapProjection.ts`,
   znaczniki drzew: `src/geo/forestMarkers.ts`.

Slugi gmin: bez zmian dla gmin z mocków (`suprasl`…), przy powtarzających się nazwach sufiks
`-miasto` (gmina miejska) albo powiat (`jablonna-legionowski`); `Gmina.teryt` łączy z PRG i bazą.
Gmina spoza danych gry dostaje statystyki z generatora mocków.

Odświeżenie danych (pobiera PRG ~380 MB do `.cache/geo` tylko za pierwszym razem):

```bash
npm run geo:build
```

```bash
npm run geo:verify
```

Źródła i licencje: PRG i BDOT10k – GUGiK (dane otwarte); lesistość – GUS BDL; mapa – © OpenStreetMap
(ODbL), kafle OpenFreeMap / OpenMapTiles – podpis na karcie jest wymagany. Docelowo własne kafle
(BDOT10k + Bank Danych o Lasach) – wystarczy podmienić `TILEJSON_URL` w `src/services/live/map.ts`.

4. **Dystans i trasa wyprawy** – w trybie „GPS urządzenia” `watchPositionAsync` (iOS: ok. 5 m / 4 s, High; web:
   `navigator.geolocation.watchPosition`). Filtr w `src/geo/track.ts`: odrzuca odczyty mniej dokładne niż 35 m,
   drganie (krok < max(4 m, dokładność)), postój i skoki > 12 km/h (po 3 z rzędu, np. jazda autem – nowy odcinek
   bez doliczania). Ślad jest **tylko w pamięci** (`useTrackStore`), znika po restarcie. Podsumowanie rysuje trasę
   na mapie okolicy (`RouteMap`) dokładnie w wersji do publikacji: uproszczona do ~50 m i bez stref ~200 m wokół
   startu i mety każdego odcinka (losowo przesunięte, żeby nie wskazać domu ani parkingu). W symulacji – wiarygodny
   spacer wokół punktu symulacji. Śledzenie działa tylko z aplikacją na pierwszym planie.
5. **Województwa** – zakładka Gminy: wybór z 16 województw (arkusz od dołu, zapamiętany). Każde ma mapę cieplną
   z granic PRG (offline): tapnięcie gminy płynnie ją przybliża (pudło palcem → najbliższa gmina), w przybliżeniu
   nazwy gmin, szczypanie / przeciąganie / podwójne tapnięcie, kółko myszy na webie i „Pełny widok”; tapnięcie
   zaznaczonej gminy albo podpowiedzi → szczegóły. Tryb mock: podlaskie – ranking i stopnie gmin gry z makiety
   (pozostałe gminy z generatora); inne – ranking wszystkich gmin z generatora mocków (punkty z liczby grzybiarzy
   i lesistości). Z bazą – ranking, mapa cieplna i statystyki z zebranych grzybów (patrz [Backend](#backend-supabase)).
   Matematyka widoku (skala, granice, trafienia, etykiety) – `src/geo/mapView.ts`.
6. **Prognoza grzybowa** – pigułki z makiety „Prognoza grzybowa 4/5” i „2 dni po deszczu” (albo „Bez deszczu od
   2 tygodni”) w karcie „Wykryto region”, karta prognozy na ekranie gminy (punkt wewnątrz gminy z PRG) i pigułka na mapie
   pełnoekranowej; tap → arkusz z uzasadnieniem, pogodą na 3 dni i podpisem „Dane pogodowe: Open-Meteo.com (CC BY 4.0)”.
   Źródło: [Open-Meteo](https://open-meteo.com/) Forecast API, wołane z telefonu w obu trybach (mock i Supabase), bez klucza:
   `past_days=14&forecast_days=3`, dzienne opady, temperatura min / maks / średnia, wilgotność i kod pogody
   (`src/services/live/weather.ts`). Do API trafia tylko kratka 0,1° (~11 × 7 km), nie pozycja; wynik z kratki 3 h
   w pamięci i AsyncStorage (maks. 6 kratek, „Wyczyść dane” je usuwa), limit 8 s, bez sieci pigułki znikają (pigułki
   lasu zostają), podczas pobierania – pulsująca pigułka. Model (`src/utils/forecast.ts`, testy w `src/utils/__tests__`)
   to **heurystyka**: „dni po deszczu” = dni od ostatniego dnia z opadem ≥ 3 mm (maks. 14, inaczej brak); ocena 1–5 =
   wilgoć (suma opadów z 14 dni, najlepiej 3–10 dni po deszczu) × warunki (średnia z 7 dni najlepiej 10–20 °C,
   przymrozek obniża; wilgotność powietrza) × pora roku (lip–paź pełnia, maj–cze i listopad średnio, gru–kwi nisko).
   Symulacja pozycji (panel dev, `?scenario=…`) nie pyta API: Supraśl ma stałą prognozę z makiety (4/5, 2 dni po deszczu),
   inne gminy – zmyśloną pogodę stałą w ciągu dnia (`src/services/mock/weather.ts`); przełącznik sieci symuluje offline.
   Uwaga: darmowe API Open-Meteo jest tylko do użytku niekomercyjnego – przy płatnej wersji / reklamach potrzebny plan
   komercyjny (klucz i `customer-api.open-meteo.com`, podmiana `OPEN_METEO_URL`).

Nie jest jeszcze prawdziwe: nazwy kompleksów leśnych poza gminami z mocków i śledzenie wyprawy w tle (aplikacja
zamknięta / ekran zablokowany).

## Mapy offline

W lesie często nie ma zasięgu, więc mapę okolicy można pobrać wcześniej. Gmina i lesistość działają offline zawsze
(granice PRG są w aplikacji); mapy offline dotyczą lasów, dróg leśnych i wody na mapie okolicy.

- **Skąd pobrać:** mapa pełnoekranowa → przycisk w prawym górnym rogu → arkusz „Mapa offline”: **Okolica (5 km)**
  (kwadrat ±5 km wokół pozycji, zwykle 16–25 kafli) albo **Cała gmina** (kafle, które dotykają granic gminy z PRG – średnio
  ~27 kafli, największa gmina w Polsce 118; limit 400 kafli, powyżej 10 MB pytamy). Przed pobraniem – szacunek „ok. X MB”
  (kafle × 25 KB, gmina miejska × 70 KB; w praktyce lasy i wsie to 9–12 KB na kafel). Też z ekranu gminy: karta
  „Mapa gminy na offline”. Postęp (kafle, MB), anulowanie (usuwa niepełny obszar), komunikat po zakończeniu; plakietka
  **„Mapa offline ✓”** i ikona przypiętej mapy, gdy cały widok mapy (±4 km) jest w pobranych obszarach.
- **Ustawienia → Mapy offline** (`app/ustawienia/mapy-offline.tsx`): lista obszarów (nazwa, rozmiar, data, stan), usuwanie
  (kasuje tylko kafle, których nie używa inny obszar), „Ponów” dla niepełnych, zajęte miejsce (mapy offline / pamięć
  podręczna), „Wyczyść pamięć podręczną map”, podpis © OpenStreetMap (ODbL) / OpenFreeMap.
- **Pamięć podręczna:** każdy kafel pobrany przy oglądaniu mapy trafia na dysk; ponad 30 MB wypadają najdawniej używane
  (LRU; kafle obszarów offline się nie liczą i nie wypadają). Kafel z pamięci podręcznej starszy niż 30 dni przy zasięgu
  jest pobierany na nowo (bez zasięgu – ten z dysku); kafle obszarów offline się nie przedawniają (odświeżenie = usuń
  i pobierz ponownie).
- **Zapis:** iOS / Android – `dokumenty/tiles/13/<x>/<y>.pbf` (surowe kafle MVT) + `dokumenty/tiles/index.json` (rozmiar,
  ostatnie użycie, data zapisu); przy starcie indeks jest uzgadniany z plikami. Web – IndexedDB `grzyb-tiles`
  (bez IndexedDB, np. w trybie prywatnym, tylko pamięć do zamknięcia karty – ekran Map offline to pokazuje). Metadane
  obszarów (`grzyb.offlinemaps.v1`, AsyncStorage): nazwa, prostokąt, lista kafli, rozmiar, data, stan.
- **Bez zasięgu:** mapa składa się z kafli na telefonie; brak kafla pod pozycją = placeholder, brak dalszych = puste miejsca
  i pigułka „Część mapy niedostępna offline” (odległość do lasu liczona tylko tam, gdzie dane są kompletne). Po błędzie sieci
  mapa przez 8 s nie czeka na sieć (pojedynczy kafel czeka maks. 12 s) – w lesie karta nie wisi na „wczytuję”.
- **Panel dev → Sieć wyłączona** = las bez zasięgu: mapa tylko z dysku (z pominięciem pamięci operacyjnej), pobieranie
  obszarów kończy się błędem sieci (po 6 błędach z rzędu przerywamy – obszar „niepełny”, „Ponów” przy zasięgu).
- **„Wyczyść dane” nie usuwa map offline** – to nie są dane gry, a gracz pobrał je świadomie (często przez Wi-Fi). Eksport
  danych i usuwanie konta ich nie dotyczą. Prywatność: obszar to prostokąt z kafli (dokładność ~3 km) i nazwa gminy,
  nigdy pozycja GPS; nic z tego nie trafia na serwer.

**Fair use OpenFreeMap** (darmowy serwer bez klucza): co najwyżej 4 kafle naraz – wspólny limit dla mapy i pobierania
obszarów (`MAX_PARALLEL_FETCHES` w `src/services/live/map.ts`); hurtowo pobieramy wyłącznie obszar wybrany przez gracza,
bez prefetchu w tle i bez wznawiania przerwanych pobrań po restarcie. Przy większej skali – własny serwer kafli
(np. ten sam plik planet z OpenFreeMap / Protomaps) i podmiana `TILEJSON_URL`.

Kod: `src/geo/tiles.ts` (zakres kafli dla promienia / prostokąta / gminy, szacunek, różnica obszarów, wybór LRU),
`src/services/live/tileStore.ts` (indeks, LRU, przypięcie), `src/store/useOfflineMapsStore.ts` (obszary, kolejka pobierania),
`src/components/OfflineMaps.tsx` (arkusz, karta gminy, podpowiedź). Testy: `src/geo/__tests__/tiles.test.ts`,
`src/services/live/__tests__/tileStore.test.ts`, `src/store/__tests__/useOfflineMapsStore.test.ts`. Kontrola na prawdziwych
kaflach (≤ 9 kafli z OpenFreeMap, zapis w układzie z telefonu, dekodowanie parserem aplikacji):

```bash
npm run maps:check
```

## Szanse i mapa gatunków

„Gdzie i kiedy co znaleźć” – tylko z agregatów na całą gminę, nigdy z punktów znalezisk.

- **Szczegóły gminy → „Szanse na wyprawie”** (`src/components/SpeciesChances.tsx`, pod prognozą): 8 najbardziej
  prawdopodobnych gatunków – akcent rzadkości, % z paskiem i jedno zdanie „dlaczego” („Często znajdowany w gminie
  w ostatnich 2 tyg. · Szczyt sezonu”, „Po deszczu – lubi wilgoć”). Trujące też (czerwony pasek, „Nie zbieraj – tylko
  zdjęcie”), bo warto je sfotografować do atlasu. „Dziś / Ten tydzień”, (i) → arkusz „Skąd te szanse?” (jak liczymy,
  prywatność, „to szacunek”), tap → karta gatunku.
- **Start → karta „Wykryto region”:** jedna linijka „Najbardziej prawdopodobne tu: podgrzybek 95% · borowik 81% · kurka
  58%” (tylko jadalne i niechronione, bez powtórzeń nazwy; na wąskim ekranie krócej – „Szanse tu: podgrzybek 95% ·
  borowik 81%”, zawsze jedna linia); bez danych, offline i poza sezonem – nic. Tap → gmina.
- **Karta gatunku → „Sezon i występowanie”** (`src/components/SpeciesSeason.tsx`): 12 słupków z `seasonWeights`
  (bieżący miesiąc wyróżniony), „Szczyt: wrzesień–październik” + faza teraz, siedliska (gdy nie ma ich karta „O gatunku”)
  i mapa województwa z ekranu Gminy (`VoivodeshipHeatmap`): gdzie gatunek zbiera się w tym sezonie, podpowiedź „12 okazów”,
  „Najczęściej w: Supraśl, Michałowo, Gródek” (tap → gmina), stan pusty i offline.
- **Atlas:** filtr „Teraz w sezonie” (waga bieżącego miesiąca ≥ 0,5 – także nieodkryte gatunki) i zielona kropka sezonu
  na kafelkach (także w Profilu).

**Model** (`src/utils/chances.ts`, czysta funkcja – ten sam w mockach i w trybie Supabase): λ gatunku = oczekiwana liczba
znalezisk na ok. 3-godzinnej wyprawie = bazowe znaleziska (prognoza 1/5 → 2 … 5/5 → 12, × aktywność sezonu całego
katalogu – zimą ≈ 0, × lesistość gminy) × udział gatunku; szansa = 1 − e^(−λ), obcięta do 1–95%. Udział = wygładzenie
bayesowskie zbiorów gminy z 14 dni (α = 40 pseudo-znalezisk prioru) – prior: sezon dnia (`seasonWeights` interpolowane;
brak → krzywa wg rzadkości lip–paź, wiosenne – mar–cze) × rzadkość (100 / 20 / 4 / 1) × popularność w koszyku × siedlisko
vs lesistość; × wilgoć dla kurek, opieniek, koźlarzy… (1–10 dni po deszczu ×1,3, susza ×0,7). „Ten tydzień” = średnie λ
z 7 dni, prognoza wraca do typowego dnia (3/5). Szczegóły i uzasadnienia – nagłówek pliku i [NOTES.md](NOTES.md).

**Dane:** `StatsService.getSpeciesChances(gminaId, date?, { forecast, horizon })` i `getSpeciesMap(speciesId, voivodeship,
period)`. Mock (`src/data/mock/chances.ts`): zbiory z generatora „Co tu się zbiera” (deterministycznie: gmina × tydzień),
te same progi prywatności co serwer. Supabase: RPC `get_gmina_species_evidence` i `get_species_map` (migracja
`20261013120000_chances.sql`, [docs/backend.md](docs/backend.md#etap-8--szanse-na-gatunki-i-mapa-gatunku)). Zbiory gmin
i mapy gatunków – w pamięci 10 min (`src/utils/ttlCache.ts`). Testy: `src/utils/__tests__/chances.test.ts`,
`src/data/mock/__tests__/chances.test.ts`, `src/services/supabase/__tests__/chances*.test.ts`, `npm run db:test` (etap 8).

## Prywatność (wymóg produktowy)

Lokalizacja nigdy nie jest publikowana na żywo. Wpis trafia do feedu dopiero po zakończeniu wyprawy,
z dokładnością do gminy lub przybliżonej trasy. W typach: `Post.publishedAt`, `Post.visibleFrom`
(+24 h dla innych), `TripPost.routePrecision: 'gmina' | 'approximate'`; mock feedu ukrywa cudze wpisy
sprzed `visibleFrom`, a własny pokazuje od razu z adnotacją „widoczne za 24 h”.

Współrzędne GPS są tylko w pamięci (`useRegionStore`, `useTrackStore`, bez persist) – gmina liczona jest na telefonie,
a opublikowany wpis ma tylko znacznik „trasa przybliżona / ukryta”, bez geometrii.
Serwer kafli mapy dostaje wyłącznie numery kafli (obszar ok. 3 × 3 km), nie dokładną pozycję, a Open-Meteo (prognoza
grzybowa) – tylko współrzędne zaokrąglone do 0,1° (~11 × 7 km). Mapy offline zapisują na telefonie tylko kafle i prostokąt
z kafli (bez pozycji GPS).

Szanse na gatunki i mapa gatunku korzystają wyłącznie z łącznych liczb na gminę: tylko odebrane znaleziska po opóźnieniu
prywatności (24 h), gatunek w gminie / gmina na mapie dopiero przy ≥ 2 różnych znalazcach, a zbiory gminy w ogóle – przy
≥ 3 znalazcach i 5 znaleziskach w ostatnich 14 dniach (k-anonimowość; te same progi w mockach, a telefon dodatkowo odrzuca
gatunki z < 2 znalazcami). Nigdy punktów znalezisk ani tego, kto co znalazł.

Regulamin i polityka prywatności (szkice do weryfikacji prawnej) opisują dokładnie to działanie – Ustawienia →
„Informacje prawne”, treść w `src/data/legal.ts`, kopie Markdown w [docs/legal](docs/legal) (patrz [Wydanie](#wydanie)).

## Aparat, profil, powiadomienia, społeczność

- **Aparat** (`app/scan.tsx`, `src/services/live/camera.ts`) – podgląd `expo-camera` na żywo za UI skanu (wnętrze
  pierścienia przezroczyste), prawdziwa zgoda systemowa, latarka (`enableTorch`), pauza po utracie fokusu / w tle.
  Postęp skanu i rozpoznanie gatunku nadal symulowane (bez modelu). Spust robi zdjęcie (720 px, JPEG 0,6;
  na iOS w `documents/finds/`, na webie mały data URI ≤ ~120 KB, łącznie ~1,2 MB). Zdjęcie widać na Analizie, Nagrodzie,
  w ostatnich znaleziskach, Podsumowaniu, karcie gatunku i jako okładkę własnego wpisu w Feedzie. Brak kamery
  (web bez kamery, symulator) → paski i „podgląd kamery niedostępny”, skan działa dalej bez zdjęcia. Zdjęcie jest zawsze
  przekodowanym JPEG-iem (expo-image-manipulator – bez EXIF, więc bez GPS); z backendem Supabase trafia też do Storage
  (patrz [Zdjęcia w Storage](#backend-supabase)).
- **Profil** – Ustawienia (⚙ w Profilu): edycja profilu, gmina domowa, „Konto i logowanie”, „Pobierz moje dane”,
  „Usuń konto”, powiadomienia, „Domyślnie ukrywaj trasę”, „Zablokowani”, „Informacje prawne” (regulamin, polityka
  prywatności), „Mapy offline”, „O aplikacji”, „Wyczyść dane” (mapy offline zostają).
  Avatar: zdjęcie z aparatu / galerii (kwadrat 256 px; iOS: `documents/avatars/`,
  web: data URI ≤ ~60 KB) albo jeden z 12 motywów (`src/data/avatars.ts`). Nick: 3–20 znaków a–z 0–9 . _.
  Przy backendzie Supabase imię, nick, gmina domowa i motyw avatara trafiają też do `profiles` (best effort), a zdjęcie
  profilowe – do publicznego koszyka Storage `avatars` (inni widzą je w feedzie, komentarzach i u znajomych).
- **Powiadomienia** – lokalne (`expo-notifications`): przypomnienie o serii (o wybranej godzinie, tylko w dni bez
  wyprawy), „wpis widoczny dla innych” (24 h po publikacji), reakcje i komentarze znajomych (mock: symulowane,
  Supabase: prawdziwe – patrz niżej), zaproszenia do znajomych, wyzwania w obserwowanych
  gminach, podsumowanie tygodnia (nd 19:00), „Wciąż w lesie?” po 3 h wyprawy. Wszystko trafia też do centrum
  powiadomień (dzwonek w Feedzie). Na webie i w Expo Go na Androidzie – tylko centrum w aplikacji; bez push z serwera.
- **Społeczność** – komentarze (optymistyczne, z cofnięciem przy braku sieci), ukrywanie wpisów („Cofnij”,
  „Ukryte wpisy · Przywróć”), zgłaszanie wpisów i komentarzy, znajomi (wyszukiwarka po nicku, zaproszenie linkiem przez
  arkusz udostępniania / schowek, usuwanie), zaproszenia w obie strony („Zaproszenia” – Akceptuj / Odrzuć, „Wysłane” –
  Anuluj), mini profil autora, strona linku zaproszenia (`/zaproszenie/<nick>`, też `grzybobranie://zaproszenie/<nick>`).
  Tryb mock: dane w mockowej bazie (`useMockDb`), domyślni znajomi odtwarzają feed z makiety, dodanie znajomego działa
  od razu (bez zaproszeń). Tryb Supabase: wszystko z serwera – patrz [Backend (Supabase)](#backend-supabase).

## Konto, onboarding i Twoje dane

**Onboarding** (`app/onboarding.tsx`, kroki i walidacja – `src/utils/onboarding.ts`, zapis – `src/store/onboarding.ts`).
Dopóki `useUserStore.onboarded` jest `false`, `app/_layout.tsx` (`Stack.Protected`) pokazuje tylko ekran powitalny – bez
zakładek i bez „wstecz” do nich (dostępne zostają regulamin, polityka prywatności i `/dev`). Sześć kroków z kropkami
postępu, „Dalej” / „Wstecz” (także systemowe „wstecz” na Androidzie):
1. **Powitanie** – co robi aplikacja (skanuj grzyby, XP i atlas, rywalizacja gmin bez ujawniania miejscówek); z serwerem
   także „Już masz konto? Zaloguj się kodem z e-maila” (logowanie na konto zabezpieczone na innym telefonie);
2. **Bezpieczeństwo** – ramka i zasady z regulaminu (`SAFETY_NOTICE`, `SAFETY_RULES` w `src/data/legal.ts`), informacja,
   że rozpoznawanie działa na razie w trybie demonstracyjnym, wymagane „Rozumiem – aplikacja nie decyduje, czy grzyb jest
   jadalny”;
3. **Regulamin i prywatność** – skrót, linki do pełnych dokumentów, wymagane „Akceptuję regulamin i politykę prywatności”
   i „Mam ukończone 16 lat”;
4. **Profil** – imię lub pseudonim („widoczne dla innych”), nick (walidacja jak w edycji profilu + sprawdzenie, czy nie jest
   zajęty), motyw avatara; pola wypełnione z bieżącego profilu;
5. **Gmina domowa** – „Użyj mojej lokalizacji” (wykrycie gminy na telefonie) albo wyszukiwarka 2479 gmin
   (`src/components/GminaPicker.tsx` – ta sama co w Ustawieniach); trzeba ją wybrać świadomie;
6. **Uprawnienia** – lokalizacja, aparat, powiadomienia z wyjaśnieniem i „Włącz” (odmowa → „Ustawienia”) albo „Później”.

Koniec: profil w store, regulamin (`terms: { version: LEGAL_VERSION, acceptedAt }`) i `onboarded = true`; z serwerem
kolejka wysyła po kolei `profile.update` (+ `photo.avatar` przy zmianie motywu) → `terms.accept` (`accept_terms`) →
`onboarding.complete` (`complete_onboarding`). Kiedy onboarding się pokazuje: tryb mock – gracz demo i zapisani gracze
mają go za sobą (migracja stanu v4), scenariusz „Nowy użytkownik” zaczyna od niego; tryb Supabase – pierwsze uruchomienie
(bez zapisu w telefonie), a przy pierwszym powiązaniu z kontem decyduje serwer (`onboardedAt = null` → onboarding), więc
wylogowanie, usunięcie konta i logowanie na konto bez onboardingu też do niego prowadzą.

**Konto i logowanie** (Ustawienia → „Konto i logowanie”, `app/ustawienia/konto.tsx`; tryb mock – karta „Konto działa
z backendem Supabase”). Stan: **konto anonimowe** („Twoje postępy są tylko na tym urządzeniu i na serwerze pod anonimowym
kontem – zabezpiecz je e-mailem”) albo **zabezpieczone** (adres e-mail) + identyfikator konta.
- **Zabezpiecz konto e-mailem** – adres → 6-cyfrowy kod z e-maila (`updateUser({ email })` → `verifyOtp` typu
  `email_change`): ten sam `user.id`, postępy zostają. „Wyślij kod ponownie” po 60 s, „Zmień adres”, kod wklejony / z
  autouzupełnienia sprawdza się sam. Błędy po polsku: zły kod, kod wygasł (po 15 min), adres ma już konto (z przejściem
  do logowania tym adresem), zły adres, za dużo prób, brak sieci (`src/utils/account.ts`).
- **Zaloguj się na inne konto** – adres → kod (`signInWithOtp` z `shouldCreateUser: false` → `verifyOtp` typu `email`) →
  potwierdzenie („postępy z tego telefonu zastąpi stan konta…”; niewysłane zdarzenia: „Synchronizuj teraz” / „Odrzuć
  i kontynuuj”) → `switchAccount()` (`src/services/supabase/sync.ts`, pod blokadą silnika synchronizacji): kolejka
  starego konta porzucona, telefon wyczyszczony, stan nowego konta z serwera jak przy pierwszym uruchomieniu (także
  onboarding). Stare konto anonimowe (bez adresu nie da się do niego wrócić) usuwa się w tle swoją, jeszcze ważną sesją.
- **Wyloguj** (tylko konto z e-mailem) – ostrzeżenie → nowe konto anonimowe → czysty telefon → onboarding.

**Usuń konto** (Ustawienia → „Usuń konto”, `app/ustawienia/usun-konto.tsx`): co zniknie (z serwera –
`prepare_account_deletion().counts`, w mockach – z telefonu), link „Najpierw pobierz kopię swoich danych”, potwierdzenie
nickiem, czerwony przycisk. Supabase: `prepare_account_deletion` → pliki w Storage (ścieżki z serwera + własne foldery) →
`delete_my_account` → gdy SQL nie usunął konta auth (chmura) – Edge Function `delete-account` → wylogowanie, czysty
telefon (gra, kolejka, zdjęcia, powiadomienia), nowe konto anonimowe → onboarding. Edge Function niedostępna → „Usunięcie
konta wymaga połączenia z serwerem produkcyjnym”, dane w telefonie zostają (ponowna próba jest bezpieczna). Mock: czysty
telefon i „serwer” mocków → onboarding.

**Pobierz moje dane** (Ustawienia → „Pobierz moje dane”): plik `grzybobranie-eksport-RRRR-MM-DD.json` – z serwerem
`export_my_data()` (format `grzybobranie-export-v1`) + `"local"`: to, co jest tylko w telefonie (profil z opisem „O mnie”
i avatarem, regulamin i onboarding, wyprawy i znaleziska ze ścieżkami zdjęć, ustawienia, centrum powiadomień);
w mockach – sam `"local"` (plus znajomi i zablokowani z „serwera” mocków). Telefon: plik w cache + systemowe
„Udostępnij” (`expo-sharing`), web: pobranie pliku. Scalanie – czyste funkcje w `src/utils/exportData.ts`.

**Blokowanie** – „Zablokuj” w mini profilu (PlayerSheet), w menu „⋯” wpisu i w menu komentarza (przytrzymanie), zawsze
z potwierdzeniem („Nie zobaczycie nawzajem swoich wpisów i komentarzy, a znajomość zostanie usunięta”); wpisy / komentarze
zablokowanego znikają od razu, feed i znajomi odświeżają się. Ustawienia → Prywatność → „Zablokowani (n)” – lista
z „Odblokuj” (znajomość nie wraca). Supabase: `block_user` / `unblock_user` / `get_blocked_users` (blokada w obie strony
na serwerze – feed, komentarze, wyszukiwarka, aktywność, zaproszenia); mock: lista w `useMockDb` i te same filtry.

## Backend (Supabase)

Schemat bazy, RLS i logika gry po stronie serwera: [docs/backend.md](docs/backend.md)
(migracja w `supabase/migrations/`, seed z mocków: `npm run db:seed`, test bez Dockera: `npm run db:test`).
Włączenie: `.env.local` z `EXPO_PUBLIC_BACKEND=supabase` + adres i klucz (wzór w `.env.example`), restart `npx expo start`.
Bez tego (tryb mock) aplikacja działa jak dotąd – bez kolejki i bez sieci.

**Gra local-first + synchronizacja.** Każda akcja liczy się od razu w telefonie (jak w mockach – UI natychmiast,
działa offline w lesie), a jej zdarzenie trafia do trwałej kolejki (`src/store/useOutboxStore.ts`):
`trip.start`, `find.submit` (wynik rozpoznania z mocka + ujęcia skanu – tymczasowo, do czasu modelu AI),
`find.claim`, `find.discard`, `trip.progress` (dystans najwyżej co minutę), `trip.finish` (bez śladu GPS – zostaje
w pamięci), `trip.publish` (publikacja w feedzie, zawsze po `trip.finish`; okładka wysyłana tuż przed nią), `profile.update`
(zawsze cały profil z motywem avatara, w kolejce tylko najnowszy), `challenge.accept`, `gmina.follow` oraz zdjęcia:
`photo.find` (zdjęcie znaleziska, zawsze po `find.submit`), `photo.avatar` (zdjęcie profilowe, w kolejce tylko najnowsze)
i `photo.delete` (sprzątanie Storage), a z onboardingu `terms.accept` (`accept_terms`) i `onboarding.complete`
(`complete_onboarding`) – serwer bez tych funkcji (sprzed etapu 6) je pomija, bez blokowania kolejki. Silnik (`src/services/supabase/sync.ts`)
wysyła je po kolei (FIFO) do RPC przy połączeniu, powrocie aplikacji na pierwszy plan, nowym zdarzeniu (debounce
300 ms) i co minutę, dopóki kolejka nie jest pusta. Brak sieci → ponowienie po 5 s, 15 s, 60 s, potem co 2 min;
błąd biznesowy serwera (np. `unknown_gmina`, `find_not_found`) → zdarzenie wypada do listy odrzuconych.

**Serwer jest źródłem prawdy.** Gdy kolejka jest pusta, aplikacja pobiera `get_game_state()` i przyjmuje jego
liczby (`src/services/supabase/gameState.ts`): profil, poziom/XP, seria, atlas, odznaki, osiągnięcia, zadania dnia,
wyprawy i znaleziska. Stan nie jest przyjmowany, gdy w międzyczasie doszło zdarzenie, na ekranie Nagroda ani przed
„Zbieram dalej” (XP zadań i osiągnięć serwer płaci od razu, telefon po ekranie Nagroda). Wyprawy i znaleziska są
scalane: zdjęcia, ukrycie trasy, publikacja w feedzie i czas trwającej wyprawy zostają z telefonu, starsze
wyprawy spoza okna serwera (30 ostatnich) też.

**Feed, znajomi i aktywność z serwera** (`src/services/supabase/feed.ts`, mapowanie odpowiedzi – `feedMap.ts`).
Feed („Znajomi” / „Moja gmina”, pull-to-refresh = pobranie od nowa), wpis i komentarze (id komentarza nadaje telefon –
ponowienie nie dubluje), reakcje, ukrywanie, zgłoszenia, wyszukiwarka, znajomi z zaproszeniami w obie strony i mini
profile idą prosto do RPC. Bez sieci ekrany pokazują swoje stany offline – bez cichego powrotu do mocków. Wyjątek to
publikacja: „Opublikuj w feedzie” działa też offline – zdarzenie idzie kolejką, a feed od razu pokazuje własny wpis
z adnotacją „wysyłanie…” (reakcje i komentarze pod nim – po synchronizacji), dopóki serwer nie zwróci wpisu tej wyprawy.
Odrzucona publikacja (np. koniec wyprawy nie dotarł na serwer) znika z feedu, a wyprawę można opublikować ponownie.
Inni widzą avatar (zdjęcie ze Storage albo motyw) i okładki wpisów – patrz niżej. **Aktywność:** zamiast symulowanych reakcji aplikacja pyta
serwer (`get_activity`) przy starcie, po powrocie na pierwszy plan i co 2 min – reakcje, komentarze, zaproszenia
i przyjęte zaproszenia trafiają do centrum powiadomień (kategoria „Reakcje i komentarze znajomych”) z toastem;
tapnięcie prowadzi do komentarzy wpisu albo do Znajomych.

**Rankingi i statystyki gmin z bazy** (`src/services/supabase/stats.ts`, mapowanie – `statsMap.ts`). Zakładka Gminy:
ranking województwa (Tydzień / Sezon / Rekordy) i mapa cieplna tylko z prawdziwych zbiorów – gminy bez punktów są szare
(stopień 0), pusty ranking ma stan „bądź pierwszy”, a baner mówi, które miejsce ma Twoja gmina (albo że nie ma jeszcze
punktów). **Opóźnienie prywatności:** serwer liczy rankingi z XP starszych niż 24 h, więc dzisiejsza wyprawa wchodzi do
rankingu jutro (podpis pod listą); Twój wkład w banerze jest bieżący. Szczegóły gminy: grzybiarze, grzyby, gatunki, rekordy
sezonu, „Co tu się zbiera” i wyzwanie (gminy z makiety – stałe, pozostałe – tygodniowe), z pustymi stanami. „Większy niż
X% okazów” na Analizie / Nagrodzie / karcie gatunku liczy się z okazów gminy w sezonie; gdy nikt jeszcze nie zebrał tam
tego gatunku – „Pierwszy taki okaz w gminie w tym sezonie!”. **Przyjęcie wyzwania** i **obserwowanie gminy** działają od
razu w telefonie i idą kolejką (`challenge.accept`, `gmina.follow` – w kolejce tylko najnowszy stan gminy), a stan z serwera
(`get_game_state`, ekran gminy) je nadpisuje; wyzwanie zalicza się znaleziskiem tego gatunku w gminie wyzwania. Bez sieci –
stany offline ekranów (bez cichego powrotu do mocków). Tryb mock bez zmian (ranking podlaskiego z makiety).

**Zdjęcia w Storage** (etap 5; `src/services/supabase/photos.ts`, operacje Storage – `storage.ts`, ścieżki i adresy –
`storagePaths.ts`). Trzy koszyki (migracja `20261010100000_storage.sql`, szczegóły w [docs/backend.md](docs/backend.md)),
każdy plik w folderze gracza (`{uid}/…`), bajty czytane z telefonu dopiero przy wysyłce (kolejka trzyma tylko odnośnik):
- **zdjęcie znaleziska** → prywatny `scan-photos/{uid}/{findId}.jpg`, potem `set_find_photo`; znalezisko dostaje
  `photoPath`. Na nowym telefonie / po reinstalacji `get_game_state` zwraca `photoPath`, a aplikacja w tle pobiera
  zdjęcie przez podpisany adres do `documents/finds/` (web: mały data URI w budżecie localStorage, większe – znacznik
  `sb-photo:` wczytywany z sieci przez podpisany adres, odświeżany przed wygaśnięciem). Odtworzone zdjęcia nie są
  wysyłane ponownie; porzucone znalezisko kasuje swój plik (`photo.delete`);
- **okładka wpisu** → publiczny `post-media/{uid}/{tripId}-{8 znaków losowych}.jpg` (najlepsze znalezisko ze zdjęciem,
  ta sama reguła co dotąd), wysyłana przy `trip.publish` tuż przed `publish_trip(…, p_cover_path)`. Brak zdjęcia albo plik
  odrzucony (413 / 415) → wpis bez okładki; brak sieci → ponowienie. Inni widzą okładkę z publicznego adresu, własny wpis
  – zdjęcie z telefonu;
- **zdjęcie profilowe** → publiczny `avatars/{uid}/avatar-{czas}.jpg` + `profiles.avatar_path`; motyw albo usunięcie
  zdjęcia → `avatar_path = null`; stare pliki gracza są usuwane. Na nowym telefonie avatar przychodzi z serwera.
Błąd sieci → ponowienie jak inne zdarzenia; plik za duży / zły format (413 / 415) i błędy biznesowe (`find_not_found`,
`invalid_path`) → zdarzenie wypada z kolejki z czytelnym komunikatem w panelu `/dev`. Zdjęcia sprzed tej wersji zostają
w telefonie (bez dosyłania), poza zdjęciem profilowym – to aplikacja raz dosyła, gdy serwer nie ma żadnego.

**Pierwsze połączenie konta = nowy gracz.** Przy pierwszej synchronizacji z danym kontem (nowe konto anonimowe)
lokalny gracz demo (Kuba, Lv 14) jest zastępowany stanem serwera – świeżym graczem od poziomu 1 (z tym, co zdążył
zagrać offline). Bio i avatar zostają lokalne (avatar z serwera, gdy telefon go nie ma albo zmienił się na innym
urządzeniu); obserwowane gminy i przyjęte wyzwania – z serwera.

**Konto (etap 6)** – onboarding z serwera (`onboardedAt`, `termsVersion` w `get_game_state().profile`), e-mail z kodem,
logowanie na inne konto, wylogowanie, usunięcie konta, eksport i blokowanie – patrz
[Konto, onboarding i Twoje dane](#konto-onboarding-i-twoje-dane), kontrakt: [docs/backend.md](docs/backend.md) → „Etap 6”.

**Panel `/dev` → Backend:** konto (anonimowe / e-mail), adres lokalnej skrzynki z kodami (Mailpit, `:54324` – tylko adresy
lokalne), powiązanie, kolejka (typ, próby, ostatni błąd; „Zdjęcia: X w kolejce”), odrzucone zdarzenia, czasy
ostatniej synchronizacji i pobrania stanu oraz przyciski: „Synchronizuj teraz”, „Pobierz stan z serwera”,
„Wgraj gracza demo” (Kuba Nowak, Lv 14, atlas i odznaki z mocków – do porównań z makietą), „Nowy gracz (reset
na serwerze)” (usuwa też pliki gracza ze Storage – `dev_reset_player().storagePaths`) i „Nowe konto” (nowe konto
anonimowe → świeży gracz; pliki starego konta zostają w Storage). Dwa środkowe wymagają `app_config.dev_tools`
na serwerze (lokalnie włącza je seed). Sekcja „Społeczność”: „Dodaj testowych grzybiarzy” (`dev_seed_social` – boty
z wpisami, 6 z nich to Twoi znajomi, 2 zapraszają Cię do znajomych) i „Grzybiarze reagują” (`dev_bots_act` – boty
przyjmują Twoje zaproszenia, Twoje wpisy stają się widoczne od razu, znajomi reagują i komentują, ktoś nowy zaprasza;
aktywność od razu trafia do centrum powiadomień), też wymagają `dev_tools`. Sekcja „Rankingi i statystyki gmin”:
„Wygeneruj aktywność w gminach” (`dev_seed_activity` dla województwa z zakładki Gminy – ciche boty z historią zbiorów
z 8 tygodni, zawsze też w podlaskim; serwer od razu przelicza rankingi) i „Przelicz rankingi” (`dev_refresh_rankings`),
też z `dev_tools`; ekrany Gmin pobierają dane od nowa. Akcje dev z reszty panelu (XP, gatunki,
odznaki, scenariusze, reset) są tylko lokalne – w trybie Supabase nadpisze je następne pobranie stanu z serwera.

Test lokalnie (Docker, telefon w tej samej sieci): `npx supabase start`, `.env.local` z adresem `http://<IP komputera>:54321`,
`npx expo start` → `/dev` → Backend („Połączono”, „Powiązanie: tak”) → wyprawa, skan, nagroda, koniec wyprawy →
kolejka pusta, w Studio (`:54323`) wiersze w `trips` / `finds`. Offline: wyłącz Wi-Fi, zagraj, włącz – kolejka się wyśle.
Społeczność: `/dev` → „Dodaj testowych grzybiarzy” → Feed (wpisy botów z ich motywami avatarów), Znajomi (2 zaproszenia)
→ wyprawa → „Opublikuj w feedzie” („wysyłanie…” → wpis z serwera) → `/dev` → „Grzybiarze reagują” → dzwonek
(reakcje, komentarze, zaproszenie). Dwa konta: drugi telefon / przeglądarka – wyszukaj nick i zaproś.
Rankingi: świeża baza → Gminy („Ranking jest jeszcze pusty”, szara mapa) → `/dev` → „Wygeneruj aktywność w gminach” →
Gminy (ranking, mapa cieplna, trend) → gmina → rekordy, „Co tu się zbiera”, „Przyjmij wyzwanie” / „Obserwuj” → `/dev` →
kolejka pusta, w Studio wiersze w `user_challenges` / `gmina_follows`.
Zdjęcia: skan z prawdziwym aparatem → `/dev` („Zdjęcia: 0 w kolejce”) → Studio → Storage → `scan-photos/<uid>/` →
koniec wyprawy, „Opublikuj w feedzie” → `post-media/<uid>/` (okładkę widzi drugie konto po 24 h albo po „Grzybiarze
reagują”) → Ustawienia → Edytuj profil → zdjęcie → `avatars/<uid>/` (drugie konto widzi je w wyszukiwarce). „Nowe
urządzenie” na tym samym koncie: Ustawienia → „Wyczyść dane” → po synchronizacji zdjęcia znalezisk i avatar wracają
z serwera (w kolejce nie pojawia się żadne `photo.find`).
Konto: Ustawienia → „Konto i logowanie” → „Zabezpiecz konto e-mailem” → kod z Mailpit (`http://<IP komputera>:54324`,
link w `/dev` → Backend i pod polem kodu) → „Konto zabezpieczone”. Drugi telefon / przeglądarka: onboarding → „Zaloguj się
kodem z e-maila” → ten sam gracz (postępy, onboarding już zakończony). Blokowanie: drugie konto → mini profil → „Zablokuj” →
wpisy i komentarze znikają w obie strony. „Pobierz moje dane” → plik JSON; „Usuń konto” → wpisz nick → onboarding nowego konta
(w Studio brak wiersza w `auth.users` i plików w Storage).

## Wydanie

**Narzędzia deweloperskie** (`src/config.ts`): `DEV_TOOLS = __DEV__ || EXPO_PUBLIC_DEV_TOOLS === '1'`. W `npx expo start`
zawsze włączone; w buildzie – tylko z flagą (profile `development` i `preview` w `eas.json`, `production` – bez). Bez nich:
brak wiersza „Panel symulacji (dev)” w Ustawieniach i przytrzymania avatara na Starcie, `/dev` (też
`grzybobranie://dev`) przekierowuje na start, a zapisany stan symulacji z buildu deweloperskiego jest przy starcie
zastępowany GPS-em i aparatem urządzenia, włączoną siecią, czasem ×1 i brakiem wymuszonego skanu (`releaseSimState`
w `src/store/useSimStore.ts`). Linki `?scenario=` działają tylko w dev (web). Lokalnie można sprawdzić wydanie:
`npx expo start --no-dev --minify` (bez flagi w `.env.local`).

**Ekran błędu.** `ErrorBoundary` w `app/_layout.tsx` (konwencja expo-router) pokazuje „Coś poszło nie tak” z „Spróbuj
ponownie” i „Wróć na start” – dla błędu całego layoutu i, przez `unstable_screenErrorBoundary` na `Stack`, dla pojedynczego
ekranu (nawigacja zostaje żywa). Ekran nie zależy od store'ów ani fontów (bez wczytanych – font systemowy), z narzędziami
dev pokazuje treść błędu. Wszystkie błędy idą przez `src/utils/reportError.ts` (teraz `console.error`; tam podpina się
Sentry). W wydaniu ten sam moduł łapie globalne błędy JS i nieobsłużone odrzucenia obietnic (Hermes).

**Konfiguracja buildów** – `eas.json`:

| Profil | Co to jest | Zmienne |
|---|---|---|
| `development` | dev client (`expo-dev-client`), instalacja wewnętrzna | `EXPO_PUBLIC_DEV_TOOLS=1` |
| `preview` | build jak do sklepu, instalacja wewnętrzna (Android: APK) | `EXPO_PUBLIC_DEV_TOOLS=1` (opcjonalnie – usuń, żeby testować dokładnie wydanie); backend ze środowiska EAS `preview`, bez niego mocki |
| `production` | do App Store / Google Play, numer buildu podbijany automatycznie | `EXPO_PUBLIC_BACKEND=supabase` + adres i klucz Supabase |

`app.json`: `ios.buildNumber` i `android.versionCode` (źródło wersji lokalne – `autoIncrement` podbija je w `app.json`
przy buildzie produkcyjnym, zmianę commituj), `runtimeVersion: { policy: 'appVersion' }` (pod EAS Update; Expo Go go
nie używa), `ios.config.usesNonExemptEncryption: false` (tylko HTTPS – bez pytania o eksport szyfrowania), opisy uprawnień
iOS po polsku w konfiguracji pluginów (także kluczy, o które aplikacja nie pyta, ale które pluginy dopisują: lokalizacja
„zawsze”, ruch, mikrofon), Android: tylko aparat, lokalizacja (dokładna / przybliżona), powiadomienia, internet,
wibracje; zablokowane `RECORD_AUDIO`, lokalizacja w tle, `SYSTEM_ALERT_WINDOW` i pamięć zewnętrzna.

**Placeholdery Supabase w `eas.json`** (`https://<ref>.supabase.co`, `<klucz publishable z Supabase>`) trzeba zastąpić
przed buildem produkcyjnym: wpisz prawdziwe wartości (adres i klucz publishable są publiczne – i tak trafiają do aplikacji)
albo usuń te dwie linie z `env` i ustaw je jako zmienne środowiska EAS `production` (niżej). Nie zostawiaj placeholderów
obok zmiennych EAS – wartość z `eas.json` może je nadpisać. Klucz `service_role` nigdy nie trafia do aplikacji.

Pierwszy raz (konto Expo, projekt EAS – dopisze `extra.eas.projectId` do `app.json`):

```bash
npm install -g eas-cli
```

```bash
eas login
```

```bash
eas init
```

```bash
eas env:set --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --environment production --visibility plaintext
```

```bash
eas env:set --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value <klucz> --environment production --visibility plaintext
```

Dev client (zamiast Expo Go – potrzebny m.in. do push i natywnych modułów spoza Expo Go):

```bash
npx expo install expo-dev-client
```

```bash
eas build --profile development --platform ios
```

```bash
eas build --profile development --platform android
```

Build testowy (TestFlight / link instalacyjny) i produkcyjny:

```bash
eas build --profile preview --platform all
```

```bash
eas build --profile production --platform all
```

```bash
eas submit --platform ios --latest
```

```bash
eas submit --platform android --latest
```

Aktualizacje JS bez nowego buildu (opcjonalnie, później): `npx expo install expo-updates`, potem `eas update:configure`
i `eas update --channel production` – `runtimeVersion` jest już ustawione.

**Do zrobienia poza kodem przed wydaniem:**

- **Prawnik:** weryfikacja szkiców regulaminu i polityki prywatności (`src/data/legal.ts` → `npm run legal:md` →
  `docs/legal/*.md`), uzupełnienie miejsc w nawiasach kwadratowych (administrator, adres, e-mail, terminy, okresy
  przechowywania, region Supabase, DSA, prawa konsumenta). Publiczne adresy URL obu dokumentów (wymagają ich App Store
  Connect i Google Play) – np. strona www albo GitHub Pages z plików z `docs/legal`.
- **Supabase (chmura):** projekt w regionie UE (np. Frankfurt), umowa powierzenia (DPA), włączone logowanie anonimowe
  (Authentication → Sign In / Providers → „Allow anonymous sign-ins”), wdrożenie schematu i seed z `--cloud` – [docs/backend.md](docs/backend.md#wdrożenie).
- **Apple:** Apple Developer Program, aplikacja w App Store Connect (bundle id `com.aknsoftware.grzybobranie`),
  „App Privacy” (m.in. przybliżona lokalizacja – gmina, zdjęcia, nick i imię, identyfikator konta, treści użytkownika,
  dane z gry; bez śledzenia), ocena wiekowa (treści użytkowników), adres polityki prywatności i kontakt wsparcia, testerzy
  TestFlight. `eas build` / `eas submit` poprowadzą przez certyfikaty i klucz App Store Connect API.
- **Google:** konto Google Play Console, aplikacja (pakiet `com.aknsoftware.grzybobranie`), „Bezpieczeństwo danych”
  (jak wyżej), kwestionariusz oceny treści (IARC), grupa docelowa 16+, adres polityki prywatności, testy zamknięte (nowe konta
  osobiste: min. 12 testerów przez 14 dni przed produkcją), klucz konta usługi do `eas submit` (pierwszy plik AAB
  zwykle wgrywa się ręcznie). Podpis aplikacji – Play App Signing, keystore trzyma EAS.
- **Wymogi sklepów, których aplikacja jeszcze nie spełnia** (szczegóły w [NOTES.md](NOTES.md#wydanie-produkcja)):
  usuwanie konta z poziomu aplikacji, blokowanie użytkowników (treści użytkowników – App Store 1.2), prawdziwe rozpoznawanie
  gatunku zamiast symulacji albo jasna informacja o niej, napisy „prototyp” w Ustawieniach.

Szczegóły decyzji i rozbieżności z makietą: [NOTES.md](NOTES.md).
