# NOTES – decyzje i rozbieżności z makietą

Źródło prawdy: `Grzybobranie UI v2.dc.html`. Poniżej wszystko, co wymagało interpretacji
albo celowo różni się od pliku.

## Jak weryfikowano wygląd

Plik makiety wymaga runtime'u (`support.js`), którego nie ma w paczce, więc jego szablony
(`sc-if`, `sc-for`, `{{ … }}`) zostały rozwinięte skryptem do 10 statycznych stron 390×844
(01 idle, 01 aktywna, 02–09, rzadkość „rzadki” jak domyślnie w pliku). Aplikację (Expo web)
zrzucano w tym samym viewporcie headless Chrome, a obrazy porównywano pikselowo.

Wynik: ekrany 01–09 pokrywają się z plikiem z dokładnością do antyaliasingu i ≤ 2 px
(różnice: działający timer, obrót promieni / sweepu w chwili zrzutu oraz punkty opisane niżej).
Do odtworzenia stanów z makiety służą scenariusze w panelu `/dev` („Makieta: …”)
i linki `?scenario=…` (web, dev).

**Nie było możliwości sprawdzenia na fizycznym iPhonie / symulatorze iOS** (praca na Windows).
Do potwierdzenia na urządzeniu: pionowe położenie tekstu z `lineHeight` = rozmiar fontu
(timer 56 px, etykieta rzadkości 44 px, procent skanu 44 px) – iOS liczy je inaczej niż przeglądarka.

## Platforma i rendering

- **Pasek statusu.** Makieta zakłada 54 px nad treścią; iPhone 15/16 ma safe-area 59 pt.
  Używamy `insets.top − 5` (= 54 na iPhonie 15/16), na webie stałe 54 px. Elementy „urządzenia”
  z makiety (9:41, Dynamic Island, home indicator) rysuje system – nie są odtwarzane.
- **Cienie** – `boxShadow` (New Architecture, RN 0.86) zamiast `shadowOffset/shadowRadius`:
  daje 1:1 CSS łącznie z wieloma cieniami, `spread` i `inset` (paski XP, odznaki, ring FAB-a).
  Przyciski 3D mają cień jako osobną „płytkę” pod spodem, więc wciśnięcie to czysty `translateY`
  (4 px, 80 ms) – identyczny efekt jak `style-active` w pliku.
- **Paskowane placeholdery** – `expo-linear-gradient` z twardymi przejściami w kwadracie zakotwiczonym
  w lewym górnym rogu: kąt dokładnie 135°, a faza pasków zgodna z CSS `repeating-linear-gradient`.
- **SVG poza pierścieniami postępu.** RN nie ma gradientów stożkowych ani `filter: blur`, więc:
  sweep skanu = 25 łuków SVG z narastającą przezroczystością, promienie nagrody = 20 klinów SVG
  z maską radialną, poświata = gradient radialny SVG przybliżający `blur(26px)`.
  Pierścienie postępu (skan, avatar w profilu) – zgodnie z wymaganiem: `Circle` + `strokeDasharray`.
- **Ikony** – statyczne TTF Material Symbols Rounded (wght 500, opsz 24, FILL 0 i FILL 1) pobrane
  z Google Fonts; glyph wybierany przez codepoint (mapa w `src/components/iconCodepoints.ts`
  wygenerowana z ligatur fontu), więc nie zależymy od obsługi ligatur.
- **Wysokości linii** ustawione jawnie = `line-height: normal` przeglądarki dla tych fontów
  (Baloo 2: 1.602 em, Nunito Sans: 1.364 em – metryki typo z plików TTF).
- **OKLCH → sRGB**: pospolity `#869A73`, rzadki `#2B99E7`, epicki `#A56CDE`, legendarny `#EFA831`;
  teksty: `#0068B2` (oklch .5 .15 245), `#7A41AF` (oklch .5 .17 305).
- **Dialogi i toasty** są własne (karta w stylu aplikacji), bo `Alert.alert` nie działa na webie
  i nie pasuje do stylu. Prompty uprawnień to imitacja alertu iOS z dopiskiem „symulowany prompt systemowy”.
- **Box-sizing.** Część elementów pliku ma `content-box` (avatar 48 + ramka 3 = 54 px, miniatury 42 → 48,
  pin mapy przesunięty o 3 px) – odwzorowano rozmiary zewnętrzne, także tę asymetrię pinu.

## Interpretacje zachowania

- **Zadania dnia** – w pliku bez postępu. Dodano dyskretny licznik („2/5”, „1,3 km/5 km”) przy tytule
  i stan ukończony (zielony kafel z ✓, przekreślony tytuł). Przyjęte wyzwanie gminy pojawia się jako
  czwarty wiersz (ciemny kafel z flagą) – to „widoczne na 01” z wymagań.
- **XP za zadania** wypłacamy po „Zbieram dalej” (toast „Zadanie wykonane…”), a nie na ekranie
  Nagroda – dzięki temu rozpiska 04 jest dokładnie jak w pliku (120 + 60 + 40 + 30 = 250), a pasek
  poziomu zgadza się z sumą.
- **Odznaka „Król Puszczy”** jest na starcie zablokowana (9/10 borowików z Puszczy Knyszyńskiej),
  a pierwszy borowik ją odblokowuje – jak na ekranie Nagroda w pliku. Profil wygląda jak w makiecie
  po tym znalezisku (albo po scenariuszu „Makieta: …”); przed nim pierwsza odznaka ma kłódkę.
- **Przełącznik prywatności (05).** W pliku jest włączony z tekstem „Publikujemy gminę i przybliżoną
  trasę”. Włączony = przybliżona trasa (`routePrecision: 'approximate'`), wyłączony = „ukryj trasę”
  (tylko gmina, `hideRoute: true`, placeholder „trasa ukryta”). Dokładna trasa nie istnieje w modelu.
- **„Przyjmij wyzwanie” (07)** – w pliku przełącza na 01 z aktywną wyprawą. Tu: zapis wyzwania w store
  i powrót na 01; wyprawę startuje użytkownik (start wymaga lokalizacji). Ponowne wejście pokazuje
  „Wyzwanie przyjęte ✓”.
- **Wstecz na Analizie (03)** prowadzi do nowego skanu (jak w pliku) i porzuca nieodebrane znalezisko.
- **Skan bez wyprawy** (FAB z innej zakładki) – przy odbiorze nagrody wyprawa startuje automatycznie
  (w pliku „Zbieram dalej” zawsze prowadzi do aktywnej wyprawy).
- **Spust skanu** – zawsze aktywny (jak w pliku), pulsuje, gdy aparat jest gotowy. Nie ma już procentu skanu 360°
  ani „zaliczanych” części grzyba – skan to jedno zdjęcie rozpoznawane na serwerze (patrz „Rozpoznawanie AI” niżej).
- **Latarka** – przełącznik (ikona `flash_on` obrysowa → wypełniona na zielonym tle) + toast.
- **Rozpoznanie** – model AI ze zdjęcia (Edge Function `identify`); scenariusz z makiety (borowik XXL 410 g) daje dev-link
  `?scenario=designAnalysis` albo wymuszony wynik w panelu `/dev`. XXL = waga ≥ 125% typowej dla gatunku – tylko gdy na
  zdjęciu jest odniesienie skali. Niska pewność < 60% → „Nie jestem pewien” z listą możliwych gatunków, bez nagrody.
- **Gatunki trujące** – połowa bazowych XP (+50 za nowy gatunek), bez XXL/serii, nie trafiają do koszyka
  ani licznika grzybów, ale trafiają do atlasu („Tylko zdjęcie” w ostatnich znaleziskach).
- **Seria dni** – bonus +30 od 2 dni z rzędu, do każdego znaleziska (jak w rozpisce pliku).
- **Liczenie grzybów** – 1 znalezisko = 1 grzyb; kępki (kurki, opieńki) pokazują liczbę sztuk, np. „12 szt.”.
- **Atlas** – katalog mocków ma 36 gatunków (pierwsze 9 w kolejności z pliku), łącznie 120 wg
  `CatalogService`. „Wszystkie” pokazuje 36 kafli (odkryte + „???”). Nazwa „Pieprznik jadalny (kurka)”
  jest w siatce skracana do „Pieprznik jadalny” jak w pliku.
- **Heatmapa** – 38 gmin podlaskiego z danymi gry (5 z rankingu + 33 z wygenerowanymi statystykami), stopnie
  ze wzoru 8×7 z pliku: „Tydzień” = dokładnie wzór, „Sezon” i „Rekordy” – wariacje. Siatkę kafli zastąpiła mapa
  z granic PRG (niżej, „Gminy (06)”). „Rekordy” pokazują liczbę rekordów („42 rek.”).
- **Tytuły poziomów**: 1–4 Początkujący Grzybiarz, 5–9 Leśny Zbieracz, 10–14 Tropiciel Borowików,
  15–19 Łowca Okazów, 20–24 Strażnik Puszczy, 25+ Mistrz Grzybobrania.
- **Daty** – Podsumowanie pokazuje rzeczywistą datę wyprawy (plik: „Sobota, 4 października”).
- **Własny wpis w feedzie** – autor „Ty”, podpis „widoczne za 24 h”, pasek „Widoczne dla innych za 24 h ·
  bez dokładnej lokalizacji” i znacznik trasy (przybliżona / ukryta). Zamiast „Spróbuj też” – nic.

## Celowe odstępstwa od pliku

- **Wiersz akcji posta (09).** W pliku elementy nie mieszczą się w 390 px i przeglądarka łamie
  „Darz grzyb! 48” i „Spróbuj też” na dwie linie wewnątrz pigułek. W aplikacji zostają w jednej linii
  (łamanie w pigułce wygląda jak błąd); karta jest przez to niższa o ~18 px, a kolejne wpisy wyżej.
- **Wiersze rankingu (06)** zawijają podpis jak w pliku (wiersz „Supraśl” ma dwie linie).
- **Karta „Wykryto region” (01).** Zamiast paskowanego placeholdera „mapa okolicy” – prawdziwa mapa
  (lasy w paskach 135° w kolorach placeholdera „moss”, woda, drogi, przerywana granica gminy, podpis
  „© OpenStreetMap · OpenFreeMap”). Kropka pozycji bez zmian (24 px, przesunięcie −9 px jak w pliku),
  halo rośnie z niepewnością GPS (min. 60 px jak w pliku). Pigułki „Prognoza grzybowa 4/5” i „2 dni po
  deszczu” jak w pliku (styl 1:1), ale z prawdziwej pogody (Open-Meteo, heurystyka – README „Prognoza grzybowa”);
  w scenariuszach makiety (symulacja w Supraślu) zawsze 4/5 i 2 dni. Po nich, w tym samym zawijanym wierszu,
  „Jesteś w lesie” / „Las 400 m stąd” i „Lesistość 71%” (GUS), a przy słabym GPS „Dokładność ±1,5 km”, przy granicy
  „Przy granicy gminy” – karta jest przez to o jeden wiersz pigułek wyższa niż w pliku. Bez sieci pigułki prognozy
  znikają, w trakcie pobierania – pulsująca pigułka; tap → arkusz z uzasadnieniem i pogodą na 3 dni.
  Etykieta „Wykryto region · symulacja”, gdy pozycja pochodzi z panelu dev.
- **Nazwa gminy.** Gmina miejska wyświetla się jako „Miasto Hajnówka”, pozostałe „Gmina …”; podpis bez
  kompleksu leśnego to „powiat białostocki · podlaskie” albo „miasto na prawach powiatu · podlaskie”.
- **Porównania zrzutów z makietą** (`?scenario=…`) działają na symulowanej pozycji w Supraślu, ale
  mapa jest prawdziwa – w karcie 01 piksele różnią się od pliku celowo.

- **Profil (08) – atlas i osiągnięcia.** Zamiast pełnej siatki z filtrami pod odznakami jest jeden wiersz
  atlasu (3 ostatnio odkryte gatunki; przy < 3 dopełnione kaflami „???”) i „Zobacz wszystko” → ekran Atlasu
  z filtrami z makiety i podsumowaniem rzadkości. Pod atlasem nowa sekcja „Osiągnięcia x / Y” w tym samym
  stylu: 3 wiersze najbliżej następnego stopnia (postęp w obrębie stopnia, jak pasek w wierszu) i „Zobacz
  wszystko”. Odznaki z makiety (5 kółek) zostają bez zmian – to osobny system.
- **Osiągnięcia – wygląd.** Medal jak odznaka (kolor stopnia z palety medali rankingu + platyna), niezdobyte:
  przerywana ramka i wyszarzona ikona, sekretne: „?”. Pasek postępu zielony jak XP; kolor stopnia tylko na medalu
  i kropkach stopni. Tapnięcie wiersza → dialog ze wszystkimi stopniami i nagrodami.
- **Historia wypraw i dziennik znalezisk.** Kafle statystyk w Profilu są klikalne (wygląd bez zmian, przy dotyku
  przygasa tylko treść): „wyprawy” → `app/wyprawy.tsx`, „grzybów” → `app/znaleziska.tsx`, „gatunki” → Atlas. Oba ekrany
  biorą dane z `useTripStore` (tryb Supabase: wyprawy i znaleziska scalone z serwerem), więc działają w mockach
  i z backendem bez nowych zapytań. **Liczniki profilu mogą być większe niż lista** (gracz demo ma 42 wyprawy
  i 318 grzybów bez historii w telefonie, serwer zwraca 30 ostatnich wypraw, nowe urządzenie) – wtedy stopka
  „Starsze wyprawy / znaleziska nie są dostępne na tym urządzeniu” z obiema liczbami; sumy na górze liczą tylko to,
  co jest w telefonie. Historia: sekcje miesięcy (przyklejone nagłówki), sumy sezonu = roku (pigułki lat, gdy jest ich
  więcej niż jeden), miniatura = najlepsze znalezisko (ta sama reguła co okładka wpisu), status „Opublikowana” /
  „Prywatna”; trwająca wyprawa nie trafia na listę. Podsumowanie otwarte z historii (`?from=wyprawy`) ma strzałkę
  „Wróć” zamiast „Zamknij”, a bez śladu w pamięci (starsza wyprawa, restart) – paski z podpisem „ślad nie jest
  przechowywany”. Dziennik: grzyby = do koszyka (jak licznik profilu), gatunki i rzadkości – ze wszystkich odebranych,
  trujące osobno („tylko zdjęcie”); „Rzadkie+” = rzadkie, epickie, legendarne; „Największe” = waga, potem kapelusz;
  wyszukiwanie po nazwie polskiej i łacińskiej bez polskich znaków. Tap → karta gatunku (osobnego ekranu znaleziska
  nie ma). Listy są wirtualizowane (`SectionList` / `FlatList`), logika w `src/utils/history.ts` (testy).

## Dokończone elementy spoza makiety (2026-10-06)

- **Skan 02 z prawdziwym aparatem.** Podgląd kamery wypełnia ekran za UI z makiety; wnętrze pierścienia jest
  przezroczyste z cienką przerywaną linią, poza pierścieniem lekkie przyciemnienie i gradienty pod tekstami.
  Napis „podgląd kamery” zostaje tylko w symulacji (i w dev-linkach – domyślnie aparat symulowany, żeby zrzuty
  zgadzały się z makietą). Pierścień wypełnia się, gdy aparat jest gotowy. Bez zdjęcia (limit 10 s, błąd aparatu)
  rozpoznania nie ma – „Nie udało się zrobić zdjęcia”; porzucone znalezisko i odrzucone zdjęcie kasują swój plik.
- **Zdjęcia znalezisk** zastępują paski tam, gdzie makieta ma „zdjęcie grzyba / znaleziska” (Analiza, Nagroda,
  miniatury, Podsumowanie, karta gatunku, okładka własnego wpisu). Cudze wpisy: w mockach paski, z backendem Supabase –
  okładka ze Storage (patrz „Zdjęcia w Storage”).
  Na webie localStorage ma limit – najstarsze zdjęcia (powyżej ~1,2 MB łącznie) wracają do pasków.
- **Ustawienia** – osobny ekran zamiast dialogu ⚙ (grupy: Konto, Powiadomienia, Prywatność, Aplikacja), w stylu
  kart z makiety. „Wyczyść dane” wraca do stanu startowego demo (gracz Kuba Nowak), tak jak reset w panelu dev.
- **Avatar** – brak avatara = paski z makiety; motywy to ikona Material Symbols na kolorze z palety (rzadkości,
  zieleń, mech). Galeria nie prosi o zgodę (systemowy picker jej nie wymaga) – pytamy tylko o aparat.
- **Powiadomienia** – w foreground zamiast banera systemowego toast w aplikacji (wyjątek: powiadomienie testowe).
  Przypomnienie o serii to 7 jednorazowych powiadomień na kolejne dni, przeliczanych po każdej aktywności – dzięki
  temu nie przychodzi w dni z wyprawą. Reakcje znajomych pod własnym wpisem przychodzą dopiero po 24 h (wcześniej nikt go nie widzi).
- **Feed** – dzwonek (centrum powiadomień) w nagłówku obok „dodaj znajomego”. Ukryty wpis zostawia kartę
  „Wpis ukryty · Cofnij”. Pod własnym wpisem nikt nie komentuje przez pierwsze 24 h.
- **Gminy (06)** – pigułka województwa otwiera arkusz z 16 województwami. Wszystkie, także podlaskie, mają mapę
  cieplną z prawdziwych granic gmin (PRG) zamiast siatki kafli 8×7 – **zrzuty 06 różnią się od makiety celowo**.
  Podlaskie: ranking, baner i podpowiedź z makiety bez zmian; 38 gmin gry ma stopnie ze wzoru makiety (ich slugi
  = slugi PRG), pozostałe 81 gmin – z generatora, spłaszczone do 0–2, żeby obszar z makiety się wyróżniał. Inne
  województwa: ranking wszystkich gmin z generatora (lesistość podbija punkty – inaczej wygrywały miasta).
- **Przybliżanie mapy gmin** – tapnięcie gminy płynnie (ok. 0,4 s, ease-out) przybliża na nią: prostokąt gminy
  zajmuje ~45% mapy (2,5–10×, maleńkie miasta – 10×), gmina zostaje zaznaczona. Pudło (granica, puste tło do 28 px)
  wybiera najbliższą gminę – stąd pierwsze tapnięcie zawsze przybliża, a drugie trafia w sąsiada. W przybliżeniu
  tapnięcie innej gminy przesuwa widok (skala zmienia się tylko, gdy odbiega od idealnej > 1,6×), zaznaczonej
  albo podpowiedzi – szczegóły. Do tego szczypanie, przeciąganie (tylko po przybliżeniu – przy pełnym widoku gest
  przewija ekran), podwójne tapnięcie (2×), na webie kółko myszy (z ctrl/⌘ albo gdy mapa jest przybliżona)
  i przycisk „Pełny widok” w rogu. Od 1,8× nazwy gmin (stała wielkość, bez kolizji, większe gminy pierwsze;
  zaznaczona ma nazwę w podpowiedzi). Ostrość: w trakcie gestu skalowany jest widok (transform), po zakończeniu
  widok trafia do viewBox SVG z dokładniejszymi obrysami widocznych gmin; podmiana na drugim, ukrytym obrazie SVG
  (przełączenie ~0,1 s później), żeby nic nie mignęło. Pod spodem stale leży trzeci obraz – całe województwo
  w pełnym widoku – więc przy oddalaniu (przycisk, szczypanie) wokół przybliżonego fragmentu nie ma pustki.
  Obrys i kropka zaznaczenia gasną w trakcie przejścia (skalowane transformem puchłyby) i wracają ostre na końcu.
- **Szczegóły gminy (07)** – zamiast placeholdera „zdjęcie lasu gminy” przerywany kontur gminy z PRG
  (`GminaSilhouette`); mapa okolicy dla całej gminy wymagałaby zbyt wielu kafli. Zrzuty 07 różnią się od makiety celowo.
- **Podsumowanie (05)** – placeholder „trasa” zastępuje mapa z przybliżoną trasą, gdy ślad wyprawy jest w pamięci
  (ta sama karta 170 px). Przybliżenie = uproszczenie ~50 m + strefy prywatności ~200 m wokół startu i mety każdego
  odcinka (środek przesunięty, promień powiększony losowo per wyprawa) – przy pętli wracającej do auta przycinanie
  po długości trasy zostawiłoby widoczny parking. Bez śladu (restart, stare wyprawy) i scenariusz z makiety – paski.
- **Mapa okolicy na pełnym ekranie** – karta 01 ma dodatkowo mały okrągły przycisk „pełny ekran” (`open_in_full`)
  w prawym górnym rogu mapy; tap w przycisk albo w mapę otwiera `app/mapa.tsx`. Poza tym karta jest bez zmian.
  Pełny ekran rysuje las ciemniejszymi paskami z brzegiem (gruba linia pod wypełnieniem – szwy kafli zakrywa
  zakładka sąsiedniego kafla) i znacznikami drzew: lasy rasteryzowane do siatki ~47 m (kawałki z sąsiednich kafli
  się zlewają, woda wycina), znacznik tylko tam, gdzie mieści się w lesie, najpierw w najgłębszych miejscach,
  co najmniej 64 px od siebie – wynik zależy tylko od skali, więc przy przesuwaniu nie skacze. Odległość do lasu
  liczona z dokładnej pozycji (karta liczy ją od środka zaokrąglonego do ~10 m – różnica kilku metrów).
  Gesty (2026-10-08): wcześniej widok był zatwierdzany także w trakcie gestu (co ~70 px przesunięcia / ~25%
  oddalenia) – każde przerysowanie SVG blokowało wątek UI i na iPhonie mapa szarpała. Teraz w trakcie gestu
  tylko transform; pod spodem stały podkład z całą okolicą przy 1×, więc po dużym przybliżeniu brzegi poza
  zakładką są przez chwilę rozmyte, a ostre po puszczeniu palców. Web: `will-change: transform` tylko na czas
  gestu. Do sprawdzenia na iPhonie: płynność i pamięć bitmap SVG (podkład ~890 × 890 pt + po przybliżeniu
  szczegóły: ekran + 25%).
- **Dystans na komputerze** – Wi-Fi zwykle daje dokładność > 35 m, więc dystans z GPS praktycznie nie rośnie
  (zamierzone; do testów: symulacja albo „Spacer” w panelu dev).

## Mapy offline (2026-10-07)

Spoza makiety, w stylu aplikacji: okrągły przycisk „Pobierz na offline” w prawym górnym rogu mapy pełnoekranowej (w pustym
dotąd miejscu naprzeciw „zamknij”), arkusz „Mapa offline” w stylu arkusza prognozy, karta „Mapa gminy na offline” na ekranie
gminy (pod prognozą – **zrzuty 07 różnią się od makiety** o tę kartę), wiersz „Mapy offline” w Ustawieniach (grupa Aplikacja)
i ekran `app/ustawienia/mapy-offline.tsx`. Opis działania – README, „Mapy offline”.

- **Tylko z13** – poziom, z którego rysuje mapa okolicy (przybliżanie do 6× jest wektorowe). Na dysku surowe bajty MVT
  (mniejsze od zdekodowanych, ten sam parser – `src/geo/mvt.ts`).
- **Jeden magazyn kafli, przypięcie z listy obszarów.** Kafel wspólny dla kilku obszarów (okolica w gminie, dwie okolice)
  leży raz; usunięcie obszaru kasuje tylko kafle wyłączne (`exclusiveTiles`). Kafle obszaru są przypięte od chwili dodania
  obszaru (jeszcze przed pobraniem) – LRU pamięci podręcznej ich nie ruszy. Dopóki store obszarów nie wczyta się
  z AsyncStorage, LRU nic nie usuwa (pusta lista obszarów wyglądałaby jak „nic nie jest przypięte”).
- **Anulowanie = usunięcie niepełnego obszaru** (jak w mapach Google). Pobieranie przerwane zamknięciem aplikacji albo brakiem
  sieci (6 błędów z rzędu) zostaje jako „niepełny” z „Ponów” – bez wznawiania w tle (fair use OpenFreeMap). iOS wstrzymuje JS
  ok. 30 s po zejściu do tła, więc długie pobieranie w tle skończy się „niepełnym” (zamierzone – brak background fetch).
- **Szacunek** 25 KB / kafel (gmina miejska 70 KB) – celowo z zapasem: pomiar OpenFreeMap to 9–12 KB w lasach i na wsi,
  ~50 KB Białystok, ~90 KB Warszawa. Po pobraniu pokazujemy rzeczywisty rozmiar.
- **Limit 400 kafli** (~10 MB) praktycznie nieosiągalny dla gminy: po przycięciu do granic PRG średnio 27 kafli, największa
  (Gdańsk z wodami) 118, Pisz 109 – przycinanie oszczędza ~30% względem prostokąta. Ostrzeżenie przy szacunku > 10 MB.
  Okolica to kwadrat ±5 km, nie koło – w tym samym miejscu obejmuje cały pełny ekran (±4 km), więc od razu jest „Mapa offline ✓”.
- **Plakietka „Mapa offline ✓”** – cały zakres kafli pełnego ekranu w obszarach offline; pamięć podręczna się nie liczy
  (może wypaść). Ikona przycisku: `download_for_offline` → `downloading` w trakcie → `offline_pin` (wypełniona) przy pokryciu.
- **Mapa z brakami** – kafel pod pozycją jest wymagany (inaczej placeholder), dalsze brakujące kafle są puste, pigułka
  „Część mapy niedostępna offline”. Odległość do lasu liczymy tylko do najbliższego brakującego kafla (dalej mógłby być bliższy
  las); „Brak lasu w promieniu …” poniżej 300 m nie pokazujemy.
- **Bez zasięgu nic nie wisi:** limit 12 s na kafel, a po błędzie sieci przez 8 s mapa nie czeka na sieć (kafle z dysku od
  razu, reszta pusta). Wcześniej słaby zasięg oznaczał „wczytuję…” do skutku.
- **Pamięć podręczna** 30 MB (LRU po ostatnim użyciu), kafel starszy niż 30 dni przy zasięgu pobierany na nowo. Obszary offline
  się nie przedawniają – brak „Aktualizuj” (usuń i pobierz ponownie); do rozważenia przy dłuższym używaniu.
- **Przełącznik sieci w panelu dev** – dotąd mapa bez sieci zawsze była placeholderem; teraz czyta tylko z dysku z pominięciem
  pamięci operacyjnej (prawdziwa ścieżka „las bez zasięgu”), a pobieranie obszarów kończy się błędem sieci.
- **„Wyczyść dane”, wylogowanie, usunięcie konta** nie ruszają map offline (stan telefonu jak zgody, nie dane gry ani konta);
  eksport danych ich nie zawiera. Polityka prywatności (szkic) opisuje to w p. 3, 8 i 11.
- **Prywatność:** obszar to lista kafli + prostokąt z kafli (~3 km) i nazwa gminy – bez pozycji GPS. Podpowiedź „Pobierz mapę
  na offline, zanim wyjdziesz do lasu” – jedna sesja (flaga w store), tylko gdy gracz nie ma żadnej mapy offline.
- **Web:** IndexedDB (`grzyb-tiles`); localStorage odpada (limit ~5 MB, tylko tekst). Bez IndexedDB – pamięć do zamknięcia
  karty, ekran Map offline o tym mówi.
- **Do sprawdzenia na iPhonie:** zapis i odczyt plików (`File.write(Uint8Array)`, `File.bytes()`, `listAsRecords()` przy
  uzgadnianiu indeksu) – logika jest w testach z magazynem w pamięci, a układ katalogów i dekodowanie z dysku – w skrypcie
  `npm run maps:check` (node); tryb samolotowy: karta i pełny ekran z dysku, czas do pokazania mapy; płynność UI podczas
  pobierania (zapis indeksu ~100 KB JSON co 1,5 s).

## Backend – synchronizacja gry (tryb Supabase, etap 2)

- **Pierwsze połączenie z kontem zastępuje gracza demo** stanem z serwera (nowy gracz od Lv 1). Bez tego nowe konto
  „dziedziczyłoby” Kubę z makiety. Do porównań z makietą – „Wgraj gracza demo” w panelu `/dev`.
- **Ekran Nagroda nie zmienia liczb w trakcie animacji** – stan z serwera czeka, aż gracz wyjdzie z ekranu i dostanie
  toasty zadań/osiągnięć („Zbieram dalej”). Nagrody czekające dłużej niż 10 s (np. aplikacja zamknięta na Nagrodzie)
  nie blokują synchronizacji – serwer i tak je wypłacił, więc toasty przepadają.
- **XP wyprawy** – aplikacja dolicza do wyprawy XP zadań dnia i osiągnięć (jak dotąd), serwer w `trips.xp` liczy tylko
  znaleziska; po synchronizacji zostaje większa wartość, żeby podsumowanie nie „chudło”.
- **Odrzucona zmiana profilu** (np. zajęty nick) – toast „Ten nick jest już zajęty…”, a następne pobranie stanu
  przywraca nick z serwera. Inne odrzucone zdarzenia widać tylko w panelu `/dev` (gracz ma wynik lokalny, a serwer
  i tak go nadpisze).
- **„Wyczyść dane” / reset w panelu** w trybie Supabase czyści telefon, ale następna synchronizacja przywraca stan
  konta z serwera (to samo konto). Świeży gracz: „Nowy gracz (reset na serwerze)” albo „Nowe konto”.
- **Przyspieszenie ×10** (panel dev) – serwer dostaje czas rzeczywisty (koniec wyprawy nie może być w przyszłości),
  więc po synchronizacji zakończona wyprawa pokazuje prawdziwy czas trwania.

## Społeczność na serwerze (tryb Supabase, etap 3)

- **Zaproszenia do znajomych w obu trybach w tym samym UI.** Ekran Znajomi ma sekcje „Zaproszenia” (na górze, nad kartą
  zaproszenia – najpilniejsze; „Akceptuj” / „Odrzuć” pod wierszem, bo dwa przyciski obok nicku by go ucinały),
  „Mogą Cię znać” / wyniki wyszukiwania (przycisk wg relacji: „Dodaj” / „Wysłano” / „Akceptuj” / „Znajomi”),
  „Wysłane” („Anuluj”) i „Twoi znajomi”. Puste sekcje zaproszeń się nie pokazują – w mockach (dodanie działa od razu)
  ekran wygląda jak dotąd; jedyna zmiana: przy znajomym w wynikach „Znajomi” zamiast „Dodano”. Mini profil i strona
  linku zaproszenia mają te same przyciski. Serwer nie udostępnia imienia i nazwiska innych – pod nickiem jest @nick.
- **Własny wpis „wysyłanie…”.** Publikacja idzie kolejką (działa offline), więc wpis pojawia się od razu z adnotacją
  „wysyłanie…” w miejscu „widoczne za 24 h”; reszta karty bez zmian. Reakcje i komentarze pod nim – toast „Wpis jeszcze
  się wysyła…”. Znika, gdy feed z serwera zwróci wpis tej wyprawy; publikację odrzuconą przez serwer cofamy (toast,
  wyprawa znowu do opublikowania w Podsumowaniu).
- **Powiadomienia z aktywności** mają formę czasownika zgadywaną z nicku („Ola_W dała”, „Marek_K dał”) – profil nie ma
  płci; przy wątpliwościach forma męska. Pierwsze pobranie (nowa instalacja, „Wyczyść dane”) bierze ostatnie 7 dni.
  Aktywność pobieramy tylko na pierwszym planie (bez push z serwera), więc zamiast banera systemowego jest toast – jak
  przy innych powiadomieniach w foreground. „Wpis widoczny dla innych” zostaje lokalny (24 h po publikacji).
- **Zgłoszenie** – toast „Dziękujemy – zgłoszenie wysłane” od razu (jak dotąd), zgłoszenie idzie w tle; przy braku
  sieci drugi toast, że nie dotarło (także w mockach z wyłączoną siecią).
- **Po publikacji feed pobiera listę od nowa** (także w mockach) – wcześniej otwarta zakładka Feed nie pokazywała nowego
  wpisu do pull-to-refresh.

## Rankingi i statystyki gmin z bazy (tryb Supabase, etap 4)

- **Podlaskie bez makiety.** Z bazą podlaskie jest zwykłym województwem: ranking i mapa cieplna z prawdziwych zbiorów,
  „Twoja gmina” = wykryta z lokalizacji albo domowa (jak w innych województwach). Ranking 1:1 z pliku zostaje w mockach.
- **Mapa cieplna** – stopnie 1–4 z serwera (kwintyle miejsc w województwie), gmina bez punktów w okresie = stopień 0
  (najjaśniejszy kolor legendy). Podpowiedź na mapie pokazuje liczbę grzybiarzy tylko dla gmin z rankingu.
- **Baner nad rankingiem** (te same kolory i ikona): „Twoja gmina prowadzi w województwie!”, „Twoja gmina jest 4.
  w województwie”, „Twoja gmina nie ma jeszcze punktów w tym tygodniu” (w sezonie: „w tym sezonie”, w rekordach:
  „rekordów”), bez gminy w województwie – „N gmin walczy o podium!” albo „Żadna gmina nie ma jeszcze punktów…”. Podpis:
  „Twój wkład w tym tygodniu / w tym sezonie: N pkt” – XP gracza z serwera od początku okresu, bez opóźnienia 24 h.
- **Pusty ranking** – karta stanu jak pusty feed: „Ranking jest jeszcze pusty” + „W tym tygodniu nikt jeszcze nie zbierał
  w tym województwie – bądź pierwszy!” (sezon / rekordy – odpowiednio). Pod listą (także pustą) mały podpis z zegarem:
  „Ranking uwzględnia wyprawy sprzed 24 h – tak chronimy lokalizację grzybiarzy.” – tylko z bazą.
- **Podpis wiersza** jak w mockach („Puszcza Knyszyńska · 1 248 grzybiarzy”, bez kompleksu – „powiat sokólski”, „miasto na
  prawach powiatu”), ale liczba to aktywni grzybiarze w okresie (z odmianą: „1 grzybiarz”, „3 grzybiarzy”). Remisy mają to
  samo miejsce (1, 2, 2, 4).
- **Szczegóły gminy:** gmina bez punktów w tym tygodniu nie ma znaczka miejsca (#). Brak rekordów – karta „W tym sezonie nikt
  jeszcze nie ustanowił tu rekordu – Twój okaz może być pierwszy!”; brak zbiorów – w „Co tu się zbiera” tekst o pustym
  sezonie i opóźnieniu 24 h. Rekord = najcięższy okaz danej rzadkości: „2,3 kg” / „410 g”, bez wagi – „Ø 27 cm”
  (w mockach kania ma „38 cm”); kiedy – dniami („dziś”, „wczoraj”, „5 dni temu”, „3 tyg. temu”). Wyzwanie bez odznaki
  (tygodniowe) nie ma pigułki „Odznaka…”; ukończone – przycisk „Wyzwanie ukończone ✓” (toast zamiast przejścia).
- **Wyzwania i obserwowanie** – od razu w telefonie (zadania dnia, „Obserwujesz”) i kolejką na serwer; serwer wygrywa przy
  pobraniu stanu i na ekranie gminy, chyba że w kolejce czeka nowsza zmiana. Wyzwanie zalicza znalezisko tego gatunku
  w gminie wyzwania (jak serwer; w mockach – w dowolnej gminie, jak dotąd). Ukończone wyzwanie jest „zrobione” w zadaniach
  dnia tylko w dniu ukończenia, nieukończone znika po terminie (tygodniowe – w niedzielę o północy). Wyzwanie, które
  skończyło się, zanim przyjęcie dotarło na serwer – toast „To wyzwanie gminy już się zakończyło”. Obserwowane gminy z serwera
  (np. po reinstalacji) nie generują powiadomienia „Obserwujesz gminę…”.
- **Porównanie okazu** („W gminie X w tym sezonie”, notka na Nagrodzie): gdy nikt jeszcze nie zebrał tam tego gatunku
  (`collected = 0`) – zamiast liczb i paska zielony wiersz z pucharem „Pierwszy taki okaz w gminie w tym sezonie!” (karta
  gatunku z atlasu: „Nikt jeszcze nie zebrał tu tego gatunku w tym sezonie.”) i dopisek, że porównanie pojawi się później.
- **Powiadomienia:** podsumowanie tygodnia bierze ranking województwa gminy domowej i wkład z serwera; pusty ranking →
  zachęta „…bądź pierwszy!” zamiast „0 pkt”. Wyzwanie w obserwowanej gminie nie przychodzi, gdy gracz już je przyjął.

## Zdjęcia w Storage (tryb Supabase, etap 5)

- **Prywatność.** Każde zdjęcie (skan, avatar) jest w telefonie przekodowywane przez expo-image-manipulator (720 px JPEG 0,6
  / avatar 256 px) – nowy plik nie ma EXIF, więc nie ma w nim GPS ani modelu telefonu. Zdjęcia znalezisk leżą w **prywatnym**
  koszyku `scan-photos` (czyta je tylko właściciel, przez podpisany adres ważny godzinę) – inni ich nie widzą, nawet gdy znają
  ścieżkę. **Okładki** wpisów (`post-media`) i **avatary** (`avatars`) są publiczne, ale ich adresów nie da się zgadnąć
  (okładka: id wyprawy + 8 znaków losowych, avatar: znacznik czasu), a listować cudze foldery nie można (polityki Storage:
  tylko własny folder). Okładka to kopia zdjęcia znaleziska – publiczna od chwili publikacji, choć wpis inni widzą po 24 h.
- **Okładka = najlepsze znalezisko ze zdjęciem** (ta sama reguła co dotąd na telefonie). Wysyłana dopiero przy `trip.publish`,
  tuż przed `publish_trip`; plik odrzucony przez Storage (za duży, zły format) albo brak zdjęcia → wpis bez okładki zamiast
  odrzuconej publikacji. Ponowna publikacja tej samej wyprawy nie podmienia okładki (serwer); zbędny plik aplikacja kasuje.
  Własny wpis zawsze pokazuje zdjęcie z telefonu, a gdy go nie ma (nowe urządzenie) – okładkę z serwera.
- **Zdjęcie znaleziska w kolejce za skanem** (`find.submit` → `photo.find` → `find.claim`) – kolejka jest ściśle FIFO, więc słaby
  zasięg opóźnia też odbiór nagrody na serwerze (lokalnie wszystko dzieje się od razu). Pojedyncze zdjęcie ma ~60–150 KB,
  wysyłka ma limit 30 s. Ponowienie samego `set_find_photo` nie wysyła pliku drugi raz (pamięć sesji), a ten sam plik
  nadpisuje się (`upsert`).
- **Web.** Odtworzone zdjęcia wchodzą do localStorage jako data URI tylko w budżecie ~1,2 MB (najnowsze pierwsze, jedno
  ≤ 120 KB); reszta to znacznik `sb-photo:<ścieżka>` – miniatura dostaje podpisany adres z sieci (zbiorczo, w pamięci,
  odświeżany przed wygaśnięciem), bez sieci – paski. Gdy budżet się kończy, zdjęcie, które jest na serwerze, zamienia się
  w znacznik zamiast znikać.
- **Avatar.** Zdjęcie: nowy plik przy każdej zmianie (`avatar-{czas}.jpg`), potem stare pliki gracza są usuwane – inni od razu
  widzą nowy adres (bez starego obrazu z cache). Motyw / usunięcie → `avatar_path = null`. Telefon bez avatara (nowe
  urządzenie) bierze go z serwera; lokalne zdjęcie, które było już na serwerze, ustępuje innemu z serwera (zmiana na innym
  urządzeniu). Zdjęcie profilowe sprzed tej wersji (albo z innego konta – „Nowe konto”) aplikacja raz na sesję dosyła,
  gdy serwer nie ma żadnego. Zdjęć znalezisk sprzed tej wersji nie dosyłamy – zostają tylko w telefonie.
- **Sprzątanie Storage robi aplikacja** (SQL nie usuwa plików): porzucone znalezisko (`photo.delete` w kolejce, gdy zdjęcie
  zdążyło wyjść), odrzucone `set_find_photo` / publikacja, poprzedni avatar, „Nowy gracz (reset na serwerze)” – wszystko
  z `dev_reset_player().storagePaths` (także zdjęcie profilowe – serwer czyści `avatar_path`). **„Nowe konto” zostawia pliki
  starego konta** (anonimowe konto po wylogowaniu jest nieosiągalne – do sprzątnięcia ręcznie w Studio albo przyszłym zadaniem
  serwera).

## Konto, onboarding, dane i blokowanie (etap 6)

- **Onboarding jako trasa chroniona.** `app/onboarding.tsx` + `Stack.Protected` w `app/_layout.tsx` (zamiast nakładki):
  ekran ma własny `UiHost` (toasty, dialogi, symulowane prompty zgód), a zakładki się nie montują – Start nie pyta o lokalizację
  w tle pod onboardingiem. Zmiana `onboarded` sama przełącza ekrany (koniec onboardingu → zakładki, wylogowanie / usunięcie
  konta → onboarding) bez „wstecz” do zakładek. Regulamin, polityka i `/dev` są poza grupami (link z onboardingu, pominięcie
  w dev). Każdy nowy ekran aplikacji trzeba dopisać do grupy `guard={onboarded}` (komentarz w layoucie). Link zaproszenia
  otwarty przed końcem onboardingu ląduje na onboardingu (nie zapamiętujemy go – do zrobienia).
- **Kiedy onboarding.** Mock: gracz demo z makiety ma go za sobą (scenariusze i zrzuty bez zmian), „Nowy użytkownik” – od
  onboardingu (`&onboarding=0` w dev-linku pomija). Supabase: pierwsze uruchomienie bez zapisu w telefonie (`merge` persist
  + `setFreshInstallOnboarded(false)` z `createSupabaseServices` – bez mignięcia gracza demo), a potem decyduje serwer przy
  pierwszym powiązaniu z kontem (`onboardedAt = null` → onboarding); przy kolejnych synchronizacjach onboarding zakończony
  gdziekolwiek się liczy, a lokalnie zakończonego serwer nie cofa. Zapisani gracze sprzed tej wersji – `onboarded = true`
  (migracja v4); ich konta na serwerze mają `onboardedAt = null`, więc logowanie takim kontem na nowym telefonie pokaże
  onboarding (i poprosi o akceptację regulaminu) – świadomie, bez automatycznego „dosyłania” zgody.
- **Onboarding na jedno dotknięcie** (2026-10, zgłoszenie „za dużo klikania zgód”). Było: 6 kroków, 3 obowiązkowe pola
  wyboru (bezpieczeństwo, regulamin + polityka, 16 lat), obowiązkowy profil (imię, nick) i gmina, ekran uprawnień –
  ok. 10–11 dotknięć + pisanie + systemowe pytanie o lokalizację. Jest: jeden ekran, „Zaczynamy!” z oświadczeniem nad
  przyciskiem (`ONBOARDING_CONSENT` – akceptacja regulaminu z zasadami bezpieczeństwa, „znasz” politykę prywatności –
  to informacja, podstawą jest umowa, art. 6 ust. 1 lit. b RODO – i 16 lat / zgoda rodzica; § 3 regulaminu mówi
  „potwierdzasz to przy pierwszym uruchomieniu”). Ramka `SAFETY_NOTICE` stoi zaraz pod powitaniem (widoczna bez
  przewijania). Do potwierdzenia z prawnikiem: wystarczalność akceptacji przyciskiem zamiast pól wyboru i potwierdzenia
  wieku w oświadczeniu zamiast osobnego pola.
- **Zgody systemowe just-in-time.** Start nie pyta już o lokalizację przy wejściu (`useRegion` – `askPermission: false`):
  bez decyzji (`undetermined` + błąd `PERMISSION`) karta „Gdzie dziś zbierasz? → Włącz lokalizację”, a „Rozpocznij
  grzybobranie” zostaje aktywne (zapyta i wystartuje). Symulacja GPS (dev-linki) działa jak dotąd bez zgody.
- **Gmina domowa z GPS** (bez domyślnej Supraśli z mocków, która jest tylko wartością zastępczą): `homeGminaPending`
  w `useUserStore` (świeża instalacja z serwerem, `wipeLocalData`, scenariusz „Nowy użytkownik”) → pierwsza wykryta gmina
  (`adoptHomeGmina`, efekt na Starcie) albo ręczny wybór w Ustawieniach. Z serwerem dopiero po pierwszym przyjęciu stanu
  konta (`syncedUserId`) – `profile.update` niesie cały profil, a przed `replace` w telefonie jest gracz zastępczy.
  Gmina z serwera kasuje flagę (`buildUserState`). Nick i avatar: domyślne z serwera (`grzybiarz_xxxxxxxx`), zmiana
  w edycji profilu – onboarding nie wysyła `profile.update`.
- **Gracz demo przed pierwszą synchronizacją.** Krótki onboarding nie zasłania już pierwszej synchronizacji: jeśli przy
  „Zaczynamy!” stanu konta jeszcze nie ma (z serwerem, `syncedUserId = null`, np. offline), `completeOnboarding` zastępuje
  gracza demo nowym graczem (`freshPlayerState`, jak po wylogowaniu).
- **Kolejność zdarzeń** po onboardingu: `terms.accept` → `onboarding.complete` (FIFO).
  Serwer sprzed etapu 6 (`PGRST202`) – oba nowe zdarzenia są pomijane (`tolerated`), żeby nie blokować kolejki gry na kwadrans.
  Wersja dokumentów: `LEGAL_VERSION` = najnowsza data `updated` z `src/data/legal.ts` (dziś = `REGULAMIN.updated`).
- **Zmiana konta pod blokadą silnika.** `switchAccount()` (`src/services/supabase/sync.ts`) jest wspólne dla logowania kodem,
  wylogowania, usunięcia konta i „Nowe konto” w `/dev`: nowa sesja ustala się w środku `withSyncLock`, więc żadne zdarzenie
  starego konta nie wyjdzie z sesją nowego; potem kolejka starego konta → „Odrzucone”, czysty telefon (`wipeLocalData`:
  gra, zdjęcia, powiadomienia, „serwer” mocków; zgody i źródła GPS / aparatu zostają) i stan nowego konta (`replace`).
  To samo konto (ponowne logowanie) – nic nie czyścimy. Zły kod – nic się nie zmienia. Narzędzia dev („Nowe konto”, „Wgraj
  gracza demo”, „Nowy gracz”) nie włączają onboardingu.
- **Osierocone konto anonimowe** po zalogowaniu na inne konto aplikacja usuwa w tle jego własnym, jeszcze ważnym tokenem
  (klient pomocniczy: `prepare_account_deletion` → pliki → `delete_my_account`) – do konta bez adresu i tak nie da się wrócić,
  a dane osobowe nie powinny wisieć. Okno potwierdzenia mówi o tym wprost. Konto z e-mailem zostaje (powrót = zalogowanie).
- **Niewysłane zdarzenia przed zmianą konta**: dialog „Najpierw poczekaj na synchronizację” – „Synchronizuj teraz” (wysyła
  i kontynuuje, gdy kolejka jest pusta), „Odrzuć i kontynuuj”, „Anuluj” (`ui.choose` – dialog jako obietnica; zamknięcie tłem
  = anuluj).
- **Kod z e-maila.** GoTrue zwraca `403 otp_expired` i dla złego, i dla wygasłego kodu – rozróżniamy po czasie wysłania
  (≥ 15 min → „Kod wygasł – wyślij nowy”). Pełny kod (wpisany, wklejony, z autouzupełnienia iOS `oneTimeCode`) sprawdza się
  sam, raz na dany kod. Odliczanie „Wyślij ponownie” 60 s jak `max_frequency` w chmurze. Adres zajęty przy zabezpieczaniu →
  przycisk „Zaloguj się na konto z tym adresem” (to samo pole, ścieżka logowania). Link do Mailpit (dev, adresy lokalne).
- **Usunięcie konta.** Kolejność z docs/backend.md (pliki przed kontem – potem nikt nie wskaże, które są jego; dodatkowo
  `list(uid)` własnych folderów na pliki osierocone). Błąd plików nie blokuje usunięcia (adnotacja w panelu `/dev`). Gdy SQL
  nie może usunąć `auth.users` (chmura) – Edge Function `delete-account`; jej brak → komunikat „wymaga połączenia z serwerem
  produkcyjnym” i dane w telefonie zostają (konto na serwerze jest już puste i zanonimizowane – ponowna próba jest bezpieczna).
  Potwierdzenie nickiem (nie słowem „USUŃ”) – nick gracz zna, a pomyłka jest mniej prawdopodobna. Po usunięciu telefon
  zaczyna jak nowy gracz („Grzybiarz”, Lv 1, pusty feed) → onboarding.
- **Eksport.** Z serwerem plik = `export_my_data()` bez zmian + `"local"` (tylko telefon: opis „O mnie”, avatar, ustawienia,
  centrum powiadomień, wyprawy / znaleziska ze ścieżkami zdjęć) + `"app"` (wersja, platforma). Zdjęcia nie są dołączane –
  ścieżki (pliki ma gracz w telefonie; serwer – w swoim folderze Storage); data URI z webu pomijamy (rozmiar). Ślad GPS nie jest
  zapisywany, więc go nie ma. Telefon: `expo-sharing` (bez pluginu – tylko udostępnianie pliku, nie rozszerzenie „Udostępnij do
  aplikacji”), web: pobranie.
- **Blokowanie.** „Zablokuj” jest wszędzie, gdzie widać autora: mini profil (czerwony link pod przyciskami – akcja rzadka
  i nieodwracalna w skutkach dla znajomości), menu „⋯” wpisu, menu komentarza; zawsze z potwierdzeniem. Po blokadzie ekran
  od razu usuwa wpisy / komentarze zablokowanego (bez czekania na serwer), feed i znajomi pobierają listy od nowa. Zablokowany
  w mini profilu: chip „Zablokowany” i „Odblokuj” zamiast przycisków znajomości. Profil osoby, która zablokowała gracza,
  pokazuje „Ten profil jest niedostępny” (jak nieistniejący – serwer zwraca `P0002`). Mock: blokada tylko po stronie gracza
  (boty nikogo nie blokują); symulowane powiadomienia społecznościowe mocków nie są filtrowane.
- **Teksty.** Z Ustawień i „O aplikacji” zniknęło „prototyp”. Informację „Rozpoznawanie gatunków działa na razie w trybie
  demonstracyjnym” zastąpiło (2026-10-08, prawdziwe rozpoznawanie): „Rozpoznanie AI może się mylić – nie jedz grzyba tylko
  na podstawie aplikacji” (stopka Ustawień, Analiza, Nagroda), opis modelu w „O aplikacji”, na ekranie powitalnym i w § 2 regulaminu. Regulamin
  i polityka (szkice) opisują teraz e-mail z kodem, usuwanie konta i eksport w aplikacji oraz blokowanie (`npm run legal:md`).
- **Nie sprawdzone na urządzeniu w tej sesji** (bez uruchamiania przeglądarki / symulatora): przejścia `Stack.Protected`,
  udostępnianie pliku i autouzupełnianie kodu na iOS – logika jest w testach, a kontrakt z serwerem w teście integracyjnym
  na Dockerze (supabase-js, Mailpit).

## Szanse na gatunki i mapa gatunku (etap 8)

- **Co znaczy procent.** „% szans, że trafisz go na ok. 3-godzinnej wyprawie” = co najmniej jeden okaz (Poisson,
  1 − e^(−λ)), obcięte do 1–95% – nigdy „100%” ani „0%”, bo to szacunek. Podpis karty mówi o 3 godzinach i prognozie
  („prognoza 4/5” albo „typowy dzień sezonu”, gdy prognozy brak – offline / błąd); stopka „To szacunek, nie gwarancja…”.
- **Karta „Szanse na wyprawie” pod prognozą** (nie pod „Co tu się zbiera”): pogoda → co dziś znajdę to jeden ciąg, a karta
  nie czeka na statystyki gminy. 8 gatunków: pasek zielony (jak „Co tu się zbiera”), akcent rzadkości = pionowy pasek
  w kolorze rzadkości (jak ramki miniatur). Uzasadnienie – 2 pierwsze powody w jednej linii; kolejność powodów: dane z gminy
  > faza sezonu > wilgoć > siedlisko > rzadkość.
- **Trujące na liście** – zgodnie z grą (zdjęcie do atlasu za XP): czerwony pasek i %, pigułka „trujący” / „śmiertelny”
  (czarna, jak w atlasie), linia „Nie zbieraj – tylko zdjęcie · …”. W linijce na Starcie – tylko jadalne i niechronione
  (zbieracze pytają „co zbiorę”), bez powtórzeń krótkiej nazwy (trzy „koźlarze”). Pełne zdanie z makiety zadania
  („Najbardziej prawdopodobne tu: …” + 3 gatunki) ma ~70 znaków – na 375 pt mieści się ~42, więc linijka wybiera najdłuższy
  wariant, który się mieści: pełna etykieta + 3 → „Szanse tu:” + 3 → + 2 → + 1 (czytnik ekranu dostaje zawsze pełne zdanie).
- **„Dziś / Ten tydzień”.** Tydzień = średnio na jedną wyprawę w najbliższych 7 dniach – może być niżej niż „Dziś” po
  świetnej prognozie (dalsza pogoda wraca do typowego dnia 3/5) i wyżej po słabej. Wyjaśnia to arkusz (i). Przełączanie nie
  pyta serwera (zbiory gminy 10 min w pamięci); stare wyniki zostają półprzezroczyste do nowych – bez migania szkieletu.
- **(i) = arkusz od dołu jak szczegóły prognozy**, nie dialog: tekst jest za długi na wyśrodkowany dialog. Sekcje: jak
  liczymy (4 punkty), Prywatność (zielona ramka), trujące (czerwona), „to szacunek”.
- **Poza sezonem** (oczekiwane < 0,6 znaleziska na wyprawę) – karta zostaje z notką „Poza sezonem grzybowym…”, linijka na
  Starcie znika. Bez danych z gminy (próg prywatności, mała gmina) – notka „Brak świeżych zbiorów w tej gminie – szacunek
  z sezonu, rzadkości i lesistości”.
- **Karta gatunku – „Sezon i występowanie”** w miejscu oznaczonym przez katalog (po sobowtórach, przed statystykami). Słupki
  12 miesięcy: w sezonie (≥ 0,5) zielone, poza – jasne, bieżący miesiąc ciemnozielony z pogrubioną literą. Pigułka fazy
  („Szczyt sezonu”, „Początek…”, „Koniec…” – pomarańczowa, „Poza sezonem” – neutralna). Siedliska tylko, gdy nie pokazuje
  ich karta „O gatunku” (bez dublowania). Mapa: województwo z ekranu Gminy (wybrane / wykryte / domowe), sezon; zaznaczona na
  starcie Twoja gmina, a gdy jej nie ma w województwie – gmina z największą liczbą okazów. Podpowiedź na mapie: „12 okazów”
  dla 5 najczęstszych, dla reszty stopień słownie („sporo zbiorów”) – serwer nie zdradza liczb poza top 5.
- **Atlas:** „Teraz w sezonie” obejmuje też nieodkryte gatunki (zamknięte kafelki z kropką = „czego szukać teraz”, toast
  „Nieodkryty gatunek – teraz jest w sezonie, szukaj!”). Kropka sezonu – lewy górny róg obrazka (prawy zajmuje „×14” /
  „trujący”). Pięć filtrów nie mieści się w 375 pt – pasek przewijany w poziomie od krawędzi do krawędzi.
- **Mocki** liczą zbiory z rozkładu „Co tu się zbiera” (Supraśl: podgrzybek 38%, borowik 21%…) ×
  sezonowość dnia – więc w październiku kurki słabną, a model i ekran gminy mówią to samo. Mapa gatunku w mockach – dla
  wszystkich gmin województwa z PRG (gminy gry mają najwięcej zbiorów).
- **Do decyzji:** progi k-anonimowości (2 znalazców gatunku, 3 i 5 dla gminy) i siła prioru (α = 40) – do kalibracji na
  prawdziwych danych; popularność w koszyku (`ABUNDANCE`) dziś tylko dla 9 gatunków jak w generatorze botów.

## Katalog 120 gatunków i ochrona gatunkowa (2026-10-07)

- **Treść z badań, nie z makiety.** Makieta miała 36 gatunków (pierwsze 9 – siatka atlasu); katalog ma teraz 120
  gatunków występujących w Polsce, a 36 dawnych wpisów zostało z tymi samymi id i nazwami (atlas graczy, osiągnięcia,
  wyzwania gmin, baza). Źródła i rozbieżności: `docs/species-sources.md`.
- **Zmiany w dawnych wpisach:** gąska siarkowa `niejadalny` → `trujacy` (pl.wiki: trująca); nowe łaciny: mleczaj smaczny
  *Lactifluus volemus*, strzępiak ceglasty *Inosperma erubescens*; siedzuń sosnowy – siedlisko „U nasady jodeł” i ochrona
  częściowa (łacina *Sparassis nemecii* = synonim siedzunia dębowego). Gąska zielonka zostaje `niejadalny` (spór
  o rabdomiolizę). **Konflikt do decyzji:** „siedzuń sosnowy” to w polskiej literaturze nazwa szmaciaka gałęzistego
  (*S. crispa*) – wpis warto przemianować (np. „Siedzuń jodłowy” / „Siedzuń dębowy”), id może zostać.
- **Ochrona = tylko zdjęcie.** Rozporządzenie z 2014 r. zabrania zbioru gatunków chronionych ściśle i częściowo (smardze,
  żagwica, lakownica, żagiew wielogłowa i czaga – tylko za zezwoleniem RDOŚ), więc gra traktuje je jak trujące
  (`collected = false`) i nagradza zostawienie w lesie (+30 XP). Chroniony i trujący (borowik szatański, borowik
  korzeniasty, koronica, naparstniczka) – etykieta „Zdjęcie gatunku chronionego”, bonus też.
- **Sobowtór główny** (`lookalike` = pierwszy z `lookalikes`) dobrany tak, by atlas startowy miał nadal 3 pary
  „Mistrza sobowtórów” (gąska zielonka, koźlarz babka i purchawka mają głównego sobowtóra spoza atlasu startowego,
  groźne pomyłki są dalej na liście). UI pokazuje wszystkie sobowtóry od najgroźniejszego, więc kolejność w danych
  nie wpływa na ostrzeżenia. W bazie `lookalike_id` ma tylko główny sobowtór (sort 0) – parytet z aplikacją; gdy
  osiągnięcie zacznie liczyć wszystkie sobowtóry (`Species.lookalikes`), w `gen-seed.ts` wystarczy łączyć wszystkie.
- **Generator aktywności** (`dev_seed_activity`) i boty nadal liczą `collected` tylko z jadalności – znaleziska botów
  gatunków chronionych są „zebrane”. Do poprawki przy następnej zmianie generatora.

## Progresja na lata: diamenty, 67 osiągnięć, poziomy do 100, zadania rotacyjne (2026-10-07)

- **Diament** jako 5. stopień (brąz → … → platyna → diament). Platyna w makiecie nie istniała i była już cyjanowa, więc
  diament odróżnia się nie samym kolorem, a lodowym gradientem z obwódką, ukośnym odblaskiem i iskierką
  (`DiamondDisc`: warstwy View + `expo-linear-gradient`, bez animacji). Ten sam krążek w podsumowaniu medali i w odznace
  poziomu Lv 100+; od Lv 50 odznaka poziomu jest złota z koroną (`levelPrestige`). Medale w podsumowaniu
  „Osiągnięć” są mniejsze (16 px), żeby 5 kolumn zmieściło się w 390 px.
- **Liczniki zamiast przeszukiwania historii.** Osiągnięcia nowych kategorii liczą się z `useUserStore.counters`
  (czyste funkcje `countFind` / `countTripStart` / `countTripFinish` / `countSocial`), aktualizowanych w akcjach gry –
  `evaluateAchievements` zostaje szybkie (bez przeglądania znalezisk). W trybie Supabase liczniki przychodzą z serwera
  (`get_game_state().counters` = `player_metrics()`, cała historia) i wygrywają po synchronizacji; telefon dolicza
  zdarzenia do następnej. Wybrałem liczenie na serwerze (a nie z wypraw i znalezisk w telefonie), bo serwer zwraca
  tylko okno 30 wypraw – liczniki z telefonu byłyby zaniżone.
- **Serwer nie przepisuje `claim_find` / `finish_trip` / `publish_trip` / `toggle_reaction`.** Postęp zadań i
  synchronizacja osiągnięć idą przez wyzwalacze na `finds`, `trips`, `posts`, `post_reactions`, `post_comments`,
  `friendships` – działa też dla bezpośrednich INSERT-ów (RLS pozwala klientowi wstawić reakcję / komentarz) i przetrwa
  kolejne wersje tych funkcji (np. ochrona gatunkowa w `claim_find` z migracji katalogu). Koszt: `completedQuestIds`
  w nagrodzie z serwera wymienia tylko skany i rzadkie (pętla `claim_find`) – aplikacja i tak pokazuje swoje.
- **Zadania rotacyjne** losowane deterministycznie z (id gracza, dzień) – ten sam hash i generator w TS i SQL, więc
  telefon offline pokazuje te same zadania co serwer (test parytetu w db:test). Zadanie dystansu tygodnia liczy
  kilometry tygodnia (`weeklyQuests.km`), dnia – kilometry dnia (jak dotąd). Zadanie „Daj Darz grzyb!” liczy różne cudze
  wpisy z reakcją w okresie – cofnięcie i ponowienie reakcji nie nabija. „Wyrusz przed 7:00” liczy się przy starcie
  wyprawy (także w kolejce offline, jeśli start był dziś). Zadania „znajdź gatunek” są tylko dla gatunków
  z `seasonWeights` i tylko w miesiącach z wagą ≥ 0,5.
- **Odznaki** z liczników w obu trybach i w tych samych chwilach co serwer: Ranny ptaszek i Seria 7 dni przy starcie
  wyprawy, 100 km przy dystansie, Król Puszczy i Łowca Legend przy znalezisku (wcześniej w trybie mock „Ranny ptaszek”
  był nieosiągalny, a 100 km i seria sprawdzały się tylko przy znalezisku).
- **Zestawy-rodziny po rodzaju w id** (`borowik-`, `podgrzybek-`, `kozlarz-`, `goryczak-`, `piaskowiec-`… →
  borowikowate; `golabek-` / `mleczaj-` → gołąbkowate; `muchomor-`, `maslak-`, `gaska-`) zamiast ręcznych list – rosną
  razem z katalogiem; „Borowiki i spółka” zostały jako 11 klasycznych rurkowych (opis zmieniony – to już nie „wszystkie”).
  Progi katalogowe (smakosz 60/70 jadalnych, rzadkie 25/35, legendy 10/10, trujące 22/30, śmiertelne 7/9, pary
  sobowtórów 35) dobrane do katalogu 120 gatunków.
- **Sekretne nowe** zależą od czasu lokalnego (11:11, noc 22–4, Wigilia, piątek 13.): telefon – czas urządzenia,
  serwer – Europe/Warsaw; w Polsce to to samo.
- **Nowy gracz** (`freshPlayerState`) ma `lastActiveDate` puste – pierwsza wyprawa zaczyna serię od 1 (jak
  `last_active_date = null` na serwerze); wcześniej pierwszy dzień nowego gracza nie liczył się do serii.
- **Migracja zapisu v5:** nowe liczniki odtworzone, ile się da (wyprawy z profilu, seria 7 / ranny ptaszek z odznak),
  reszta od zera; osiągnięte już stopnie (także nowych osiągnięć i platyny / diamentu) – nagrodzone bez XP.
- **Scenariusze dev-linków** przypinają 3 zadania z makiety i ukrywają tygodniowe – zrzuty Startu jak w pliku.

## Stany dodatkowe (spoza makiety, w tym samym stylu)

Szkielety ładowania (region, gminy, szczegóły gminy, feed, statystyki gatunku), błąd lokalizacji
(„Włącz lokalizację, aby rozpocząć”, „Jesteś poza Polską”, „Nie udało się ustalić pozycji”),
mapa okolicy offline („mapa niedostępna offline” pod kropką pozycji – gdy jej kafli nie ma na telefonie; raz z podpowiedzią
o mapach offline), odmowa aparatu, brak sieci (gminy, feed, publikacja,
rozpoznanie), pusty atlas i feed, niska pewność, gatunek trujący, potwierdzenie zakończenia wyprawy,
potwierdzenie przerwania skanu, LEVEL UP (rozbłysk, animacja etykiety, haptyka Success).

## Wydanie (produkcja)

- **Narzędzia deweloperskie za flagą** (`src/config.ts`): `DEV_TOOLS = __DEV__ || EXPO_PUBLIC_DEV_TOOLS === '1'`. Preview ma
  je włączone (testerzy mogą symulować GPS, sieć i skan), produkcja – nie. Bez nich `/dev` robi `<Redirect href="/">`
  (zostaje w drzewie tras – deep link nie kończy się 404), a stan symulacji jest „czyszczony” już przy hydratacji
  (`merge` w persist `useSimStore`) – zanim cokolwiek go odczyta, także `mockInit`, który w trybie urządzenia odczytuje
  zgody z systemu. Zgody zostają, wymuszony wynik skanu jest zawsze wyłączony. Dev-linki
  `?scenario=` zostają za samym `__DEV__` (web).
- **Ekran błędu na dwóch poziomach.** `export function ErrorBoundary` w `app/_layout.tsx` łapie błąd całego layoutu
  (start, fonty, store'y) – wtedy nie ma nawigatora i „Wróć na start” sprowadza się do ponownego zamontowania. Ten sam
  komponent jest podpięty jako `unstable_screenErrorBoundary` głównego `Stack` (kontekst dziedziczą zakładki i stos Gmin),
  więc błąd jednego ekranu zostawia nawigację żywą: „Wróć na start” zamyka modale i zastępuje ekran startem. API jest
  „unstable” – sprawdzić po aktualizacji expo-router. Ekran błędu używa tylko RN, tokenów kolorów i expo-router; fonty
  Baloo / Nunito i ikona – tylko gdy `isLoaded`, inaczej font systemowy i „!”. Treść błędu (mono) – z `DEV_TOOLS`.
- **`reportError`** – jedyne miejsce raportowania (teraz `console.error`). W wydaniu `installGlobalErrorHandlers` opakowuje
  globalny handler RN (`ErrorUtils` – raport, potem domyślne zachowanie) i włącza tracker odrzuceń obietnic Hermesa
  (RN robi to sam tylko w dev – w wydaniu `.then()` bez `.catch()` ginął bez śladu). W dev nic nie podpinamy (LogBox).
- **eas.json:** `appVersionSource: local` – numery buildów żyją w `app.json` (`ios.buildNumber`, `android.versionCode`,
  wymagane w zadaniu), `autoIncrement` podbija je przy buildzie produkcyjnym. Każdy profil ma `environment`
  (zmienne środowisk EAS). Adres i klucz Supabase w `production.env` to placeholdery – do zastąpienia albo usunięcia na rzecz
  zmiennych EAS (pierwszeństwo `env` z eas.json przed zmiennymi EAS nie jest jasno udokumentowane, więc nie trzymamy obu).
- **runtimeVersion `appVersion`** bez `expo-updates`: przy Expo Go CLI wpisuje do manifestu `0.1.0` zamiast `exposdk:57.0.0`,
  ale Expo Go bierze wtedy wersję SDK z `sdkVersion` w konfiguracji – działa jak dotąd.
- **Opisy uprawnień iOS.** Pluginy dopisują do Info.plist także klucze, o które aplikacja nie pyta (lokalizacja „zawsze”,
  ruch – expo-location, mikrofon – expo-camera i expo-image-picker), domyślnie po angielsku. Zamiast je usuwać (`false`)
  dajemy polskie teksty: kod natywny tych bibliotek odwołuje się do tych API, a skan binarki w App Store Connect ostrzega
  o brakujących opisach (ITMS-90683). Aparat ma jeden wspólny tekst – ten sam klucz `NSCameraUsageDescription` ustawiają dwa
  pluginy, a wynik zależałby od kolejności. Sprawdzone `npx expo config --type introspect`.
- **Uprawnienia Androida.** Jawna lista (aparat, lokalizacja dokładna i przybliżona, powiadomienia + `RECEIVE_BOOT_COMPLETED`
  dla zaplanowanych przypomnień po restarcie, internet, wibracje) i blokada: `RECORD_AUDIO` (expo-image-picker dodaje go
  przy niepustym `microphonePermission`), lokalizacja w tle, `SYSTEM_ALERT_WINDOW`, `READ/WRITE_EXTERNAL_STORAGE`
  (biblioteki deklarują je do Androida 12; galeria idzie przez systemowy wybór zdjęć, pliki – w katalogu aplikacji).
  **Do sprawdzenia na Androidzie ≤ 12:** zdjęcie profilowe z galerii – gdyby nie działało, odblokować `READ_EXTERNAL_STORAGE`.
- **Do sprawdzenia po prebuild:** `NSAppTransportSecurity` w Info.plist (introspekcja pokazuje `NSAllowsArbitraryLoads: true`
  z szablonu) – w wydaniu wystarczy HTTPS.
- **Szkice regulaminu i polityki** – jedno źródło (`src/data/legal.ts`): ekrany Ustawienia → „Informacje prawne” i
  `docs/legal/*.md` (`npm run legal:md`, test pilnuje zgodności, pliki porównywane bez względu na CRLF). Placeholdery
  w nawiasach kwadratowych, bez wymyślonych danych administratora. Treść opisuje stan faktyczny, w tym rzeczy jeszcze
  niegotowe – jako „[Do uzupełnienia / Do wdrożenia: …]”: (już nieaktualne: rozpoznanie gatunku jest od 2026-10-08 prawdziwe –
  model Claude, opisany w § 2 regulaminu i pkt 4 / 10 / 11 polityki z „[Do weryfikacji prawnej …]”), nie ma usuwania konta
  ani eksportu danych w aplikacji (na razie e-mail), nie ma logowania (utrata telefonu = utrata konta anonimowego).
  Zdjęcia: polityka opisuje docelowe działanie z Supabase Storage (zdjęcia znalezisk prywatne, okładki wpisów i avatary
  publiczne, EXIF usuwany przez ponowne zakodowanie w expo-image-manipulator).
- **Imię i nazwisko jest widoczne dla innych.** Serwer zwraca w feedzie i u znajomych `name` = `display_name` (pole
  „Imię i nazwisko” z edycji profilu), a wyszukiwarka szuka też po nim – wbrew zdaniu „serwer nie udostępnia imienia
  i nazwiska innych” wyżej (dotyczy tylko `fullName` w `SocialUser`). Polityka mówi więc wprost, że jest widoczne, i radzi
  pseudonim. Decyzja produktowa: zostawić czy pokazywać innym tylko nick.
- **Wymogi sklepów do zrobienia w kodzie:** usuwanie konta w aplikacji (App Store 5.1.1(v) – konto z nickiem i funkcjami
  społecznościowymi), blokowanie użytkowników (1.2 – treści użytkowników: jest zgłaszanie i ukrywanie wpisów, brak blokady
  autora), napisy „prototyp” w Ustawieniach i „O aplikacji” (2.2 – wersje demo). Rozpoznanie gatunku – zrobione (model AI,
  2026-10-08); w „App Privacy” / „Bezpieczeństwie danych” zdjęcia idą też do zewnętrznego dostawcy AI.
- **Bezpieczeństwo grzybów – bez zmian w kodzie.** Sprawdzone: Analiza pokazuje czerwony baner „Nie zbieraj – tylko zdjęcie”
  dla trujących i śmiertelnie trujących (osobny tekst), przycisk „Zapisz w atlasie” zamiast nagrody, żółty baner „Potwierdź
  u eksperta przed jedzeniem” przy sobowtórach; karta gatunku ma ten sam czerwony baner; niska pewność (< 60%) – „Nie jestem
  pewien”, bez nagrody.

## Rozpoznawanie AI (2026-10-08)

Symulacja skanu zniknęła: zdjęcie ze spustu rozpoznaje Edge Function `identify` (Claude, Anthropic API), a zdjęcie bez
grzyba od razu kończy się „Nie wykryłem grzyba”. Konfiguracja, koszty i limit – README „Rozpoznawanie grzyba (AI)”.

- **Skan 02 – odstępstwa od pliku.** Tytuł „Skan grzyba” zamiast „Skan 360°”, zamiast procentu (44 px) – stan aparatu
  („Wyceluj w grzyba”, „Uruchamiam aparat…”, „Brak aparatu”), bez pigułek Kapelusz / Spód / Trzon / Podstawa (były
  „zaliczane” na niby). Pierścień to kadr: wypełnia się na zielono, gdy aparat jest gotowy – nie udaje postępu analizy.
  „Sweep” pierścienia kręci się tylko podczas „Analizuję…” (zwykły wskaźnik oczekiwania na serwer, ze zdjęciem w środku).
- **Odrzucenie (nie grzyb / niewyraźne)** – karta na dole nad podglądem, który już działa (nie pełny ekran): „Spróbuj
  ponownie” od razu wraca do celowania. Powód pisze model (po polsku, przycięty do 200 znaków); przy niewyraźnym trzy
  stałe wskazówki. Grzyb spoza atlasu → „Niewyraźne zdjęcie” z powodem modelu (np. „tego gatunku nie ma w atlasie”).
- **Ostrożność.** Prompt: niższa pewność przy wątpliwościach, groźny sobowtór na liście kandydatów. Aplikacja dodatkowo:
  jadalny zwycięzca + trujący / śmiertelny kandydat z pewnością ≥ 15% → pewność najwyżej 55% („Nie jestem pewien”).
  Analiza i Nagroda zawsze pokazują „Rozpoznanie AI może się mylić…” (onboarding nie ma już pola „Rozumiem”).
- **Wymiary bez zmyślania.** Model podaje rozmiar tylko przy odniesieniu skali (dłoń, nóż, moneta); bez niego wymiary =
  typowe dla gatunku (skala 1, bez XXL). Waga = typowa × skala² (jak wcześniej – te same progi XXL i anty-cheatu
  `find_size`). Wiek z dojrzałości (młody 2 dni, dojrzały 5, stary 9, nieznany 4). Kępki – sztuki × waga jednej.
- **Widoczne części** (`visibleParts`) zastąpiły „zaliczone” części: idą w `find.submit` jako `parts` i dają podpowiedź na
  Analizie (brak podstawy trzonu przy śmiertelnym sobowtórze, brak spodu kapelusza przy sobowtórze).
- **Kontekst żądania** – tylko miesiąc i województwo (nie gmina, nie współrzędne). Funkcja buduje tekst z wartości z listy
  (bez wstrzyknięć), a prompt mówi, że tekst na zdjęciu to dane, nie polecenia.
- **Tryb mock z adresem serwera** – rozpoznawanie też działa: osobny klient z własną sesją anonimową
  (`identifyClient()`, klucz sesji `grzybobranie-identify-auth`), gra zostaje na mockach. Bez adresu i klucza – „Rozpoznawanie
  wymaga połączenia z serwerem” (a nie losowy gatunek).
- **Panel dev** – jedno wymuszenie „Wymuś wynik skanu” (gatunek + XXL / niska pewność, nie grzyb, niewyraźne) zamiast
  losowania i nadpisań rzadkości / trującego / „spust zawsze aktywny” (te pola i licznik skanów usuwa migracja zapisu
  symulacji do wersji 2). Galeria na ekranie skanu – tylko z narzędziami dev (anty-cheat: w wydaniu wyłącznie aparat).
  `ScanService` (startScan / capturePartial) i `src/services/mock/identifyPick.ts` usunięte.
- **Limit kosztów** – 60 / 24 h (okno kroczące) i jedno naraz, wywołania nieudane po stronie modelu się nie liczą; dziennik
  `identify_calls` bez zdjęć i wyników, 7 dni, kasowany z kontem.
- **Nie sprawdzone w tej sesji:** prawdziwe wywołanie Claude (koszty – testy na atrapach), `deno check`
  i `supabase functions serve` funkcji, ekran skanu na telefonie z aparatem (iOS / Android), przerwanie żądania po
  stronie Edge Function przy zamknięciu ekranu (`req.signal` – zależy od bramki Supabase).
- **Do zrobienia:** podpis wyniku rozpoznania przez serwer (dziś `find.submit` przyjmuje gatunek od telefonu – Edge Function
  może zapisać znalezisko sama albo zwrócić podpis do `submit_find`), rozpoznanie odłożone na później bez zasięgu,
  weryfikacja prawna przekazania zdjęć do Anthropic, `deno.json` z przypiętą wersją `@anthropic-ai/sdk`.

## Skan 3D (2026-10-08)

Skan z prawdziwym aparatem na telefonie z czujnikami ruchu to teraz skan 3D: gracz obchodzi grzyba, a analiza rusza sama.

- **Postęp** (`src/scan/orbit.ts`, testy w `src/scan/__tests__`) – `DeviceMotion` (expo-sensors, ~15 Hz) → kierunek tylnego
  aparatu z kątów W3C złożonych w macierz (iOS i Android podają tę samą konwencję; odporne na blokadę przegubu w pionie).
  12 sektorów po 30° względem kierunku ze startu – do zaliczenia 9 (270°, pełne koło bywa w lesie niemożliwe) po 250 ms
  spokojnego ruchu; do tego z góry (aparat ≤ -60°) i nisko przy ziemi (≥ -20°) po 500 ms. Udział: obejście 60%, z góry 20%,
  przy ziemi 20%. Machanie telefonem (> 90°/s) nic nie zalicza i podpowiada „Wolniej”.
- **Ekran** – pierścień z 12 sektorami (mapa z góry: start na dole, kropka = bieżąca pozycja) i grzybek w prawym górnym
  rogu wypełniający się od dołu na zielono (`MushroomMeter`). Podpowiedzi po kolei: obejdź → nisko przy ziemi → z góry.
  Pełny grzybek = analiza sama; spust w trakcie = „Analizuj teraz” z tym, co już jest (bez ujęć – jedno zdjęcie).
  Bez czujników (web) – dawny skan jednym zdjęciem.
- **Ujęcia** – w czasie obchodzenia ciche zdjęcia 640 px (bez dźwięku migawki i mignięcia podglądu), przy obrocie ≤ 45°/s:
  po jednym na sektor boku, z góry i przy ziemi (do 14). Do rozpoznania idą najwyżej 4 (`src/scan/views.ts`): główne
  (pierwszy bok), przy ziemi, z góry i bok najdalej od głównego. Zdjęcie znaleziska = główne; reszta zostaje w `Find.views`
  tylko w telefonie (na serwer – jak dotąd jedno zdjęcie; synchronizacja zachowuje lokalne ujęcia).
- **Podgląd 3D** (`Spin3D`) – obrotowy „stolik” z ujęć boku (przenikanie tylko przy połowie drogi, bezwładność, obrót sam
  bez dotyku): w nagłówku Analizy, w kółku „Analizuję skan 3D…”, na pełnym ekranie `/podglad3d/[findId]` (w pionie –
  ujęcia z góry / od spodu) i ze znaczka 3D przy miniaturze w dzienniku znalezisk. To podgląd z prawdziwych zdjęć, nie siatka
  3D – model 3D (np. rekonstrukcja na serwerze) to możliwy następny krok.
- **Narzędzia dev** – aparat „Symulacja” symuluje obchodzenie (`src/dev/simOrbit.ts`, ~11 s, bez zdjęć).
- **Nie sprawdzone w tej sesji:** prawdziwe czujniki i seria zdjęć na telefonie (iOS / Android) – progi kątów i prędkości
  mogą wymagać strojenia w lesie; `deno check` / `functions serve` funkcji z kilkoma ujęciami.

