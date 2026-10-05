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
- **Spust skanu** – nieaktywny < 100% (półprzezroczysty), w trybie dev zawsze aktywny. W pliku widać
  tylko stan aktywny. Części grzyba zaliczają się przy 15/40/65/95% – przy 68% są trzy, jak w makiecie.
- **Latarka** – przełącznik (ikona `flash_on` obrysowa → wypełniona na zielonym tle) + toast.
- **Rozpoznanie** – pierwszy skan to zawsze borowik XXL 410 g z makiety, kolejne z deterministycznego
  seeda (wagi wg rzadkości). XXL = waga ≥ 125% typowej dla gatunku. Niska pewność < 60% →
  „Nie jestem pewien” z listą możliwych gatunków, bez nagrody.
- **Gatunki trujące** – połowa bazowych XP (+50 za nowy gatunek), bez XXL/serii, nie trafiają do koszyka
  ani licznika grzybów, ale trafiają do atlasu („Tylko zdjęcie” w ostatnich znaleziskach).
- **Seria dni** – bonus +30 od 2 dni z rzędu, do każdego znaleziska (jak w rozpisce pliku).
- **Liczenie grzybów** – 1 znalezisko = 1 grzyb; kępki (kurki, opieńki) pokazują liczbę sztuk, np. „12 szt.”.
- **Atlas** – katalog mocków ma 36 gatunków (pierwsze 9 w kolejności z pliku), łącznie 120 wg
  `CatalogService`. „Wszystkie” pokazuje 36 kafli (odkryte + „???”). Nazwa „Pieprznik jadalny (kurka)”
  jest w siatce skracana do „Pieprznik jadalny” jak w pliku.
- **Heatmapa** – 38 kafli = 38 gmin podlaskiego (5 z rankingu + 33 z wygenerowanymi statystykami).
  „Tydzień” = dokładnie wzór z pliku, „Sezon” i „Rekordy” – wariacje. Tooltip jest pozycjonowany
  względem wybranego kafla (dla Supraśla dokładnie `left:178 top:76` z pliku). „Rekordy” pokazują liczbę
  rekordów („42 rek.”).
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
  deszczu” są ukryte do czasu podłączenia API pogodowego; zamiast nich „Jesteś w lesie” / „Las 400 m
  stąd” i „Lesistość 71%” (GUS), a przy słabym GPS „Dokładność ±1,5 km”, przy granicy „Przy granicy gminy”.
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

## Stany dodatkowe (spoza makiety, w tym samym stylu)

Szkielety ładowania (region, gminy, szczegóły gminy, feed, statystyki gatunku), błąd lokalizacji
(„Włącz lokalizację, aby rozpocząć”, „Jesteś poza Polską”, „Nie udało się ustalić pozycji”),
mapa okolicy offline („mapa niedostępna offline” pod kropką pozycji), odmowa aparatu, brak sieci (gminy, feed, publikacja,
rozpoznanie), pusty atlas i feed, niska pewność, gatunek trujący, potwierdzenie zakończenia wyprawy,
potwierdzenie przerwania skanu, LEVEL UP (rozbłysk, animacja etykiety, haptyka Success).
