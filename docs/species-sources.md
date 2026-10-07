# Katalog gatunków – źródła i rozbieżności

Katalog (`src/data/mock/species.ts`, w bazie `supabase/seed.sql` z `npm run db:seed`) ma **120 gatunków występujących
w Polsce**: 55 pospolitych, 35 rzadkich, 20 epickich, 10 legendarnych (rzadkość **gry**, nie częstość w przyrodzie).
Jadalność: 70 jadalnych, 20 niejadalnych, 21 trujących, 9 śmiertelnie trujących; 24 gatunki chronione.
Stan na październik 2026.

## Jak sprawdzano

Każdy gatunek – nazwa polska i łacińska, jadalność, sezon (miesiące owocnikowania w Polsce), siedlisko, typowe wymiary,
cechy rozpoznawcze i sobowtóry – sprawdzony w co najmniej jednym źródle: przede wszystkim polska Wikipedia
(artykuły gatunków), [grzyby.pl](https://www.grzyby.pl/) (atlas), angielska Wikipedia (toksykologia, zatrucia),
Species Fungorum / Catalogue of Life / GBIF (aktualne nazwy łacińskie), Lasy Państwowe (trufle). Lista źródeł
dla każdego gatunku – tabela na końcu.

Zasady:

- **Jadalność konserwatywna.** `smiertelny` – może zabić (amatoksyny, orelanina, gyromitryna, muskaryna z opisanymi
  zgonami); `trujacy` – powoduje zatrucia albo jadalność jest sporna / gatunek zawiera toksyny; `niejadalny` – gorzki,
  łykowaty, „jadalny” tylko w tradycji ludowej. Gatunki jadalne **tylko po obróbce** (opieńka, muchomor czerwonawy,
  gąsówka, borowik ponury, smardze, żółciak…) mają `jadalny`, a opis mówi wprost, że nie wolno ich jeść na surowo.
- **Sobowtóry**: najpierw groźne pomyłki (kania ↔ muchomor zielonawy i czubajeczki, pieczarki ↔ muchomory, smardz ↔
  piestrzenica i naparstniczka, opieńka / łuszczak / płomiennica ↔ hełmówka jadowita i maślanka wiązkowa, kurka ↔
  lisówka, twardzioszek ↔ lejkówka jadowita, gąska zielonka ↔ muchomor zielonawy, borowiki ↔ borowik szatański…).
  Nazwa sobowtóra z katalogu = nazwa z katalogu i ta sama jadalność (pilnuje test `src/data/__tests__/species.test.ts`).
  Aplikacja pokazuje sobowtóry od najgroźniejszego (`speciesLookalikes` w `src/utils/species.ts`).
- **Sezon** (`seasonWeights`, I–XII, szczyt = 1) – fenologia w Polsce wg źródeł; hubiaste wieloletnie owocniki mają
  wagę przez cały rok.

## Ochrona gatunkowa – podstawa prawna

**Rozporządzenie Ministra Środowiska z dnia 9 października 2014 r. w sprawie ochrony gatunkowej grzybów
(Dz.U. 2014 poz. 1408)** – [tekst w ELI](https://eli.gov.pl/eli/DU/2014/1408/ogl) (status: obowiązujący),
[Infor.pl](https://www.infor.pl/akt-prawny/DZU.2014.197.0001408,rozporzadzenie-ministra-srodowiska-w-sprawie-ochrony-gatunkowej-grzybow.html)
(„brak dokumentów zmieniających”) – sprawdzone 2026-10. Listy gatunków sprawdzone w tekście załączników (PDF z ELI).
Zakazy obejmują m.in. umyślne zrywanie i **zbiór** (§ 6) – dla ochrony ścisłej i częściowej.

| Ochrona | Gatunki w katalogu (pozycja w załączniku) |
|---|---|
| **ścisła** (zał. 1) – 9 | borowik królewski (lp. 7 – „borowik żółtobrązowy podgat. królewski, *Boletus appendiculatus* ssp. *regius*”), borowik szatański (lp. 8), borowik korzeniasty (lp. 6), żyłkowiec różowawy (lp. 3), kolczakówka piekąca (lp. 26), koronica ozdobna (lp. 37), krążkówka żyłkowana (lp. 48), soplówka jeżowata (lp. 49), gwiazda wieloporowa (lp. 13) |
| **częściowa** (zał. 2) – 15 | podgrzybek pasożytniczy (lp. 1 – „podgrzybek tęgoskórowy, *Xerocomus parasiticus*”), szyszkowiec łuskowaty (lp. 3), gwiazdosz czteropromienny (lp. 25), lakownica żółtawa (lp. 32), ozorek dębowy (lp. 38), żagwica listkowata (lp. 44), siatkoblaszek maczugowaty (lp. 48), naparstniczka czeska (lp. 51), smardz jadalny (lp. 54), smardz półwolny (lp. 55 – jako *Morchella gigas*), smardz stożkowaty (lp. 56), soplówka bukowa (lp. 58), błyskoporek podkorowy (lp. 60), żagiew wielogłowa (lp. 63), siedzuń sosnowy (*Sparassis nemecii* – patrz rozbieżności: synonim siedzunia dębowego *S. brevipes*, lp. 49) |

Smardze (zał. 2: „okazy rosnące poza terenem ogrodów, upraw ogrodniczych, szkółek leśnych oraz poza terenami zieleni”),
żagwica listkowata, lakownica żółtawa, błyskoporek podkorowy i żagiew wielogłowa są w **zał. 3** – można je pozyskiwać
**wyłącznie za zezwoleniem RDOŚ / GDOŚ** (§ 7 pkt 2). Dla grzybiarza bez zezwolenia to zakaz zbioru – w grze tak samo:
tylko zdjęcie.

**W grze:** gatunek chroniony nie trafia do koszyka (`collected = false`, jak trujący) – ½ bazowych XP za zdjęcie
i bonus **„Zostawiony w lesie – gatunek chroniony” +30 XP**; Analiza i karta gatunku pokazują zielony baner
„Gatunek chroniony – nie zbieraj, zrób tylko zdjęcie”.

**Nie są chronione** (choć wiele stron nadal tak podaje – to stan z rozporządzenia z 2004 r., Dz.U. 2004 nr 168
poz. 1765, które utraciło moc 2 X 2014): szmaciak gałęzisty (*Sparassis crispa*), sarniak dachówkowaty, czarka
austriacka (chroniona jest tylko czarka jurajska *S. jurana*), piaskowiec modrzak, purchawica olbrzymia, gwiazdosz
frędzelkowany, zasłonak fioletowy, mądziak psi, borowik żółtobrązowy (chroniony jest tylko podgatunek królewski).
Trufla letnia nie jest chroniona (chroniona jest trufla wgłębiona *Tuber mesentericum*).

## Rozbieżności między źródłami

**Jadalność** (w grze wariant ostrożniejszy):

- **Gąska zielonka** – tradycyjnie jadalna i nadal na polskiej liście grzybów dopuszczonych do obrotu (rozporządzenie
  z 2018 r.), ale opisano zatrucia z rabdomiolizą (Francja 2001–2003, Polska 2009, przypadki śmiertelne); część
  badaczy podważa ten związek. W grze `niejadalny` z ostrzeżeniem.
- **Gąska siarkowa** – „niejadalna” vs „trująca” (pl.wiki) → `trujacy` (zmiana względem wcześniejszej wersji gry).
- **Krowiak podwinięty** – do lat 70. uznawany za jadalny; zespół krowiaka bywa śmiertelny po wielokrotnym spożyciu
  → `trujacy` z ostrzeżeniem o zgonach (rozważono `smiertelny`).
- **Koronica ozdobna** – „trująca na surowo” vs opisany zgon i rekordowa kumulacja arsenu → `smiertelny`.
- **Naparstniczka czeska** – „jadalna, wyborna” (pl.wiki, grzyby.pl) vs zatrucia po większych ilościach (en.wiki)
  → `trujacy` (i tak chroniona).
- **Piestrzenica olbrzymia** – ok. 1500× mniej gyromitryny niż kasztanowata, brak udokumentowanych zgonów, ale
  odradzana wszędzie (we Francji zakaz sprzedaży) → `trujacy`.
- **Piestrzyca kędzierzawa** – starsze atlasy: jadalna; obecnie: zawiera związki z grupy gyromitryny → `trujacy`.
- **Borowik korzeniasty** – „niejadalny, gorzki” (źródła polskie) vs opisane zatrucia (en.wiki) → `trujacy`.
- **Borowik ponury** – jadalny po ok. 25 min gotowania, na surowo trujący; doniesienia o nietolerancji z alkoholem
  niepotwierdzone → `jadalny` z ostrzeżeniem.
- **Lejkówka szarawa** („warunkowo jadalna” vs zatrucia), **mleczaj wełnianka** (jadana po kiszeniu w Europie
  Wschodniej), **mleczaj paskudnik** (mutagenna nekatoryna), **czernidłak pospolity** (jadalny bez alkoholu),
  **czubajeczka cuchnąca** („niejadalna” vs „podejrzana”) → `trujacy`.
- **Hełmówka jadowita** – pl.wiki: brak udokumentowanych zgonów w Polsce; en.wiki: zgony w USA; zawiera amatoksyny
  → `smiertelny`. **Strzępiak ziemistoblaszkowy** – pl.wiki: zgon możliwy w skrajnych przypadkach, en.wiki: brak
  zgonów → `trujacy`. **Muchomor plamisty** – pl.wiki wspomina możliwe zgony → `trujacy` (ciężkie zatrucia).
- **Goryczak żółciowy** – „niejadalny” vs „lekko trujący” → `niejadalny`. **Muchomor cytrynowy** – „niejadalny lub
  lekko trujący” → `niejadalny`. **Zasłonak fioletowy**, **podgrzybek pasożytniczy**, **sromotnik bezwstydny**
  („jaja” jadane w tradycji) → `niejadalny`.
- **Flagowiec olbrzymi**, **żółciak siarkowy**, **szyszkowiec łuskowaty**, **krążkówka żyłkowana**, **siatkoblaszek
  maczugowaty** – jadalne (młode / po ugotowaniu) wg większości źródeł, część odradza → `jadalny` z ostrzeżeniem.

**Nazwy łacińskie** (w katalogu nazwa aktualna, poprzednia w nawiasie):
mleczaj smaczny – *Lactifluus volemus* (*Lactarius volemus*); strzępiak ceglasty – *Inosperma erubescens*
(*Inocybe erubescens*); gąsówka fioletowawa – *Collybia nuda* (*Lepista nuda*); lejkówka jadowita – *Collybia rivulosa*
(*Clitocybe rivulosa*; *C. dealbata* bywa łączona, wg Species Fungorum osobny gatunek); piestrzenica olbrzymia –
*Discina gigas* (pl.wiki, GBIF: *Gyromitra gigas*); borowik ceglastopory – *Neoboletus erythropus* (pl.wiki, GBIF) vs
*N. luridiformis* (en.wiki); mleczaj paskudnik – *Lactarius necator* vs *L. turpis* (en.wiki: synonim); smardz
stożkowaty – *Morchella conica* (nazwa z rozporządzenia; taksonomicznie grupa *M. elata*); smardz półwolny –
*Morchella semilibera* (w rozporządzeniu *M. gigas*); pieczarka leśna – *Agaricus sylvaticus* (en.wiki: *silvaticus*).

**Nazwy polskie** – katalog zostawia nazwy tradycyjne, a pl.wiki stosuje nowsze nazwy rodzajowe: suchogrzybek
złotopory (podgrzybek złotawy), koźlarek (koźlarz grabowy), ponurnik aksamitny (krowiak aksamitny), czubajnik
czerwieniejący (czubajka czerwieniejąca), pieczarka łąkowa (pieczarka polna), gołąbek zielonawofioletowy
(modrozielony), gołąbek wyborny (jadalny), muchomor czerwieniejący (czerwonawy), tęgoskór cytrynowy (pospolity),
lignopurchawka gruszkowata, żagwiak łuskowaty, modroborowik ponury, borowikowiec tęgoskórowy (podgrzybek
pasożytniczy), koźlarz torfowiskowy (białawy), lejkowiec trąbkowy (pieprznik trąbkowy), wachlarzowiec olbrzymi
(flagowiec), sromotnik smrodliwy (bezwstydny), masłoborowik żółtobrązowy / królewski, gorzkoborowik korzeniasty,
krwistoborowik szatański, krasnoborowik ceglastopory, czasznica olbrzymia (purchawica), czubajeczka brązowoczerwonawa,
gwiazda wieloporowata, sarniak świerkowy (dachówkowaty), mleczajowiec smaczny, włókniak ceglasty.

**Sezon**: soplówka jeżowata (grzyby.pl: późna jesień–zima; przyjęto VIII–XII ze szczytem w X), zasłonak rudy
(VIII–X vs VIII–XI), strzępiak ziemistoblaszkowy (IX–XI vs lato–jesień), gwiazda wieloporowa (IX–XI vs lato–jesień),
okratek australijski (VII–X vs VII–XI).

**Rzadkość gry vs przyroda**: wodnicha późna jest na czerwonej liście (kat. I) – w grze `rzadki`.

## Konflikty w katalogu gry (do decyzji)

- **Siedzuń sosnowy** (`siedzun-sosnowy`, wpis sprzed rozbudowy – id i nazwa zostają): w polskiej literaturze
  „siedzuń sosnowy” to oficjalna nazwa *Sparassis crispa*, czyli **szmaciaka gałęzistego** (osobny wpis). Wpis gry ma
  łacinę *Sparassis nemecii* – takson opisany z Czech spod jodły, który GBIF / Catalogue of Life, pl.wiki i grzyby.pl
  traktują jako synonim *S. brevipes* = **siedzuń dębowy** (ochrona częściowa, zał. 2 lp. 49). Dlatego w katalogu:
  siedlisko jodły i świerki, `protection: 'czesciowa'`, a siedzunia dębowego nie dodano osobno (dublowałby gatunek;
  jego miejsce wśród legend zajął żyłkowiec różowawy). Zalecenie: zmienić nazwę wpisu (np. „Siedzuń jodłowy”) albo
  przemianować na „Siedzuń dębowy (*Sparassis brevipes*)” – id może zostać.
- **Czubajka kania**: pierwszy sobowtór ma historyczną nazwę „muchomor sromotnikowy” (= muchomor zielonawy) – zostaje,
  bo para kania–muchomor zielonawy zmieniłaby wynik osiągnięcia „Mistrz sobowtórów” atlasu startowego.

## Źródła per gatunek

| # | Gatunek | Łacina | Jadalność | Ochrona | Źródła |
|---|---|---|---|---|---|
| 1 | Borowik szlachetny | *Boletus edulis* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Borowik_szlachetny), [pl.wiki](https://pl.wikipedia.org/wiki/Goryczak_żółciowy) |
| 2 | Podgrzybek brunatny | *Imleria badia* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Podgrzybek_brunatny) |
| 3 | Czubajka kania | *Macrolepiota procera* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Czubajka_kania), [pl.wiki](https://pl.wikipedia.org/wiki/Muchomor_zielonawy) |
| 4 | Muchomor czerwony | *Amanita muscaria* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Muchomor_czerwony) |
| 5 | Pieprznik jadalny (kurka) | *Cantharellus cibarius* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Pieprznik_jadalny) |
| 6 | Mleczaj rydz | *Lactarius deliciosus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Mleczaj_rydz) |
| 7 | Szmaciak gałęzisty | *Sparassis crispa* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Szmaciak_gałęzisty), [grzyby.pl](https://www.grzyby.pl/gatunki/Sparassis_crispa.htm) |
| 8 | Muchomor zielonawy | *Amanita phalloides* | śmiertelny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Muchomor_zielonawy), [pl.wiki](https://pl.wikipedia.org/wiki/Gąska_zielonka), [pl.wiki](https://pl.wikipedia.org/wiki/Gołąbek_zielonawy) |
| 9 | Smardz jadalny | *Morchella esculenta* | jadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Smardz_jadalny), [pl.wiki](https://pl.wikipedia.org/wiki/Piestrzenica_kasztanowata) |
| 10 | Maślak zwyczajny | *Suillus luteus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Maślak_zwyczajny) |
| 11 | Koźlarz babka | *Leccinum scabrum* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Koźlarz_babka) |
| 12 | Koźlarz czerwony | *Leccinum aurantiacum* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Koźlarz_czerwony), [pl.wiki](https://pl.wikipedia.org/wiki/Koźlarz_pomarańczowożółty) |
| 13 | Soplówka jeżowata | *Hericium erinaceus* | jadalny | ścisła | [pl.wiki](https://pl.wikipedia.org/wiki/Soplówka_jeżowata), [grzyby.pl](https://www.grzyby.pl/gatunki/Hericium_erinaceum.htm) |
| 14 | Gąska zielonka | *Tricholoma equestre* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Gąska_zielonka), [grzyby.pl](https://www.grzyby.pl/gatunki/Tricholoma_equestre.htm) |
| 15 | Opieńka miodowa | *Armillaria mellea* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Opieńka_miodowa) |
| 16 | Piestrzenica kasztanowata | *Gyromitra esculenta* | śmiertelny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Piestrzenica_kasztanowata) |
| 17 | Purchawka chropowata | *Lycoperdon perlatum* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Purchawka_chropowata), [grzyby.pl](https://www.grzyby.pl/gatunki/Lycoperdon_perlatum.htm) |
| 18 | Gołąbek zielonawy | *Russula virescens* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Gołąbek_zielonawy) |
| 19 | Żagwica listkowata | *Grifola frondosa* | jadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Żagwica_listkowata), [grzyby.pl](https://www.grzyby.pl/gatunki/Grifola_frondosa.htm) |
| 20 | Goryczak żółciowy | *Tylopilus felleus* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Goryczak_żółciowy) |
| 21 | Borowik ceglastopory | *Neoboletus erythropus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Borowik_ceglastopory), [en.wiki](https://en.wikipedia.org/wiki/Neoboletus_luridiformis), [api.gbif.org](https://api.gbif.org/v1/species/match?name=Neoboletus%20erythropus) |
| 22 | Muchomor plamisty | *Amanita pantherina* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Muchomor_plamisty) |
| 23 | Borowik królewski | *Butyriboletus regius* | jadalny | ścisła | [pl.wiki](https://pl.wikipedia.org/wiki/Borowik_królewski), [pl.wiki](https://pl.wikipedia.org/wiki/Grzyby_chronione) |
| 24 | Płachetka zwyczajna | *Cortinarius caperatus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Płachetka_zwyczajna) |
| 25 | Czernidłak kołpakowaty | *Coprinus comatus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Czernidłak_kołpakowaty) |
| 26 | Zasłonak rudy | *Cortinarius orellanus* | śmiertelny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Zasłonak_rudy), [grzyby.pl](https://www.grzyby.pl/gatunki/Cortinarius_orellanus.htm) |
| 27 | Sarniak dachówkowaty | *Sarcodon imbricatus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Sarniak_dachówkowaty), [grzyby.pl](https://www.grzyby.pl/gatunki/Sarcodon_imbricatus.htm) |
| 28 | Maślak sitarz | *Suillus bovinus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Maślak_sitarz) |
| 29 | Koźlarz pomarańczowożółty | *Leccinum versipelle* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Koźlarz_pomarańczowożółty) |
| 30 | Lejkowiec dęty | *Craterellus cornucopioides* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Lejkowiec_dęty) |
| 31 | Mleczaj smaczny | *Lactifluus volemus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Mleczaj_smaczny) |
| 32 | Siedzuń sosnowy | *Sparassis nemecii* | jadalny | częściowa | [grzyby.pl](https://www.grzyby.pl/gatunki/Sparassis_laminosa.htm), [grzyby.pl](https://www.grzyby.pl/gatunki/Sparassis_crispa.htm), [pl.wiki](https://pl.wikipedia.org/wiki/Siedzuń_dębowy), [pl.wiki](https://pl.wikipedia.org/wiki/Szmaciak_gałęzisty), [api.gbif.org](https://api.gbif.org/v1/species?name=Sparassis%20nemecii) |
| 33 | Borowik szatański | *Rubroboletus satanas* | trujący | ścisła | [pl.wiki](https://pl.wikipedia.org/wiki/Borowik_szatański) |
| 34 | Lakówka ametystowa | *Laccaria amethystina* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Lakówka_ametystowa), [grzyby.pl](https://www.grzyby.pl/gatunki/Laccaria_amethystea.htm), [en.wiki](https://en.wikipedia.org/wiki/Laccaria_amethystina) |
| 35 | Gąska siarkowa | *Tricholoma sulphureum* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Gąska_siarkowa) |
| 36 | Strzępiak ceglasty | *Inosperma erubescens* | śmiertelny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Strzępiak_ceglasty), [grzyby.pl](https://www.grzyby.pl/gatunki/Inocybe_erubescens.htm) |
| 37 | Podgrzybek złotawy | *Xerocomellus chrysenteron* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Podgrzybek_złotawy), [grzyby.pl](https://www.grzyby.pl/gatunki/Xerocomus_chrysenteron.htm) |
| 38 | Podgrzybek zajączek | *Xerocomus subtomentosus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Podgrzybek_zajączek) |
| 39 | Maślak pstry | *Suillus variegatus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Maślak_pstry) |
| 40 | Maślak żółty | *Suillus grevillei* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Maślak_żółty) |
| 41 | Maślak ziarnisty | *Suillus granulatus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Maślak_ziarnisty) |
| 42 | Koźlarz grabowy | *Leccinellum pseudoscabrum* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Koźlarz_grabowy) |
| 43 | Krowiak podwinięty | *Paxillus involutus* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Krowiak_podwinięty), [en.wiki](https://en.wikipedia.org/wiki/Paxillus_involutus), [grzyby.pl](https://www.grzyby.pl/gatunki/Paxillus_involutus.htm) |
| 44 | Krowiak aksamitny | *Tapinella atrotomentosa* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Krowiak_aksamitny) |
| 45 | Gąska niekształtna | *Tricholoma portentosum* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Gąska_niekształtna), [grzyby.pl](https://www.grzyby.pl/gatunki/Tricholoma_portentosum.htm) |
| 46 | Gąsówka fioletowawa | *Collybia nuda* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Gąsówka_fioletowawa), [speciesfungorum.org](https://www.speciesfungorum.org/Names/Names.asp?strGenus=Lepista&strSpecies=nuda) |
| 47 | Lejkówka szarawa | *Clitocybe nebularis* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Lejkówka_szarawa), [en.wiki](https://en.wikipedia.org/wiki/Clitocybe_nebularis), [speciesfungorum.org](https://www.speciesfungorum.org/Names/Names.asp?strGenus=Lepista&strSpecies=nuda) |
| 48 | Lejkówka jadowita | *Collybia rivulosa* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Lejkówka_jadowita), [en.wiki](https://en.wikipedia.org/wiki/Clitocybe_rivulosa), [speciesfungorum.org](https://www.speciesfungorum.org/Names/Names.asp?pg=5&strGenus=Clitocybe) |
| 49 | Twardzioszek przydrożny | *Marasmius oreades* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Twardzioszek_przydrożny), [en.wiki](https://en.wikipedia.org/wiki/Clitocybe_rivulosa) |
| 50 | Boczniak ostrygowaty | *Pleurotus ostreatus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Boczniak_ostrygowaty), [grzyby.pl](https://www.grzyby.pl/gatunki/Pleurotus_ostreatus.htm) |
| 51 | Łuszczak zmienny | *Kuehneromyces mutabilis* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Łuszczak_zmienny), [speciesfungorum.org](https://www.speciesfungorum.org/Names/Names.asp?strGenus=Kuehneromyces) |
| 52 | Maślanka wiązkowa | *Hypholoma fasciculare* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Maślanka_wiązkowa) |
| 53 | Czubajka czerwieniejąca | *Chlorophyllum rhacodes* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Czubajka_czerwieniejąca) |
| 54 | Czubajeczka cuchnąca | *Lepiota cristata* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Czubajeczka_cuchnąca), [en.wiki](https://en.wikipedia.org/wiki/Lepiota_cristata) |
| 55 | Pieczarka polna | *Agaricus campestris* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Pieczarka_polna) |
| 56 | Pieczarka karbolowa | *Agaricus xanthodermus* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Pieczarka_karbolowa) |
| 57 | Czernidłak pospolity | *Coprinopsis atramentaria* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Czernidłak_pospolity) |
| 58 | Lisówka pomarańczowa | *Hygrophoropsis aurantiaca* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Lisówka_pomarańczowa) |
| 59 | Mleczaj wełnianka | *Lactarius torminosus* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Mleczaj_wełnianka) |
| 60 | Mleczaj świerkowy | *Lactarius deterrimus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Mleczaj_świerkowy), [grzyby.pl](https://www.grzyby.pl/gatunki/Lactarius_deterrimus.htm) |
| 61 | Mleczaj paskudnik | *Lactarius necator* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Mleczaj_paskudnik), [en.wiki](https://en.wikipedia.org/wiki/Lactarius_turpis), [speciesfungorum.org](https://www.speciesfungorum.org/Names/Names.asp?pg=4&strGenus=Lactarius) |
| 62 | Gołąbek wymiotny | *Russula emetica* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Gołąbek_wymiotny) |
| 63 | Gołąbek modrozielony | *Russula cyanoxantha* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Gołąbek_modrożółty), [grzyby.pl](https://www.grzyby.pl/gatunki/Russula_cyanoxantha.htm) |
| 64 | Gołąbek jadalny | *Russula vesca* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Gołąbek_jadalny) |
| 65 | Muchomor czerwonawy | *Amanita rubescens* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Muchomor_czerwonawy), [en.wiki](https://en.wikipedia.org/wiki/Amanita_rubescens) |
| 66 | Muchomor cytrynowy | *Amanita citrina* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Muchomor_cytrynowy) |
| 67 | Strzępiak ziemistoblaszkowy | *Inocybe geophylla* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Strzępiak_ziemistoblaszkowy), [en.wiki](https://en.wikipedia.org/wiki/Inocybe_geophylla) |
| 68 | Piestrzyca kędzierzawa | *Helvella crispa* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Piestrzyca_kędzierzawa), [en.wiki](https://en.wikipedia.org/wiki/Helvella_crispa) |
| 69 | Uszak bzowy | *Auricularia auricula-judae* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Uszak_bzowy) |
| 70 | Hubiak pospolity | *Fomes fomentarius* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Hubiak_pospolity) |
| 71 | Pniarek obrzeżony | *Fomitopsis pinicola* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Pniarek_obrzeżony) |
| 72 | Żagiew łuskowata | *Cerioporus squamosus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Cerioporus_squamosus) |
| 73 | Tęgoskór pospolity | *Scleroderma citrinum* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Tęgoskór_pospolity) |
| 74 | Purchawka gruszkowata | *Apioperdon pyriforme* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Purchawka_gruszkowata) |
| 75 | Mądziak psi | *Mutinus caninus* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Mądziak_psi) |
| 76 | Wodnicha późna | *Hygrophorus hypothejus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Wodnicha_późna) |
| 77 | Borowik usiatkowany | *Boletus reticulatus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Borowik_usiatkowany), [api.checklistbank.org](https://api.checklistbank.org/dataset/3LR/nameusage/search?q=Boletus%20reticulatus) |
| 78 | Borowik sosnowy | *Boletus pinophilus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Borowik_sosnowy) |
| 79 | Borowik ponury | *Suillellus luridus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Borowik_ponury), [en.wiki](https://en.wikipedia.org/wiki/Suillellus_luridus), [grzyby.pl](https://www.grzyby.pl/gatunki/Boletus_luridus.htm) |
| 80 | Piaskowiec modrzak | *Gyroporus cyanescens* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Piaskowiec_modrzak) |
| 81 | Piaskowiec kasztanowaty | *Gyroporus castaneus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Piaskowiec_kasztanowaty) |
| 82 | Koźlarz białawy | *Leccinum holopus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Koźlarz_białawy), [grzyby.pl](https://www.grzyby.pl/gatunki/Leccinum_holopus.htm), [api.checklistbank.org](https://api.checklistbank.org/dataset/3LR/nameusage/search?q=Leccinum%20holopus) |
| 83 | Podgrzybek pasożytniczy | *Pseudoboletus parasiticus* | niejadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Podgrzybek_pasożytniczy), [grzyby.pl](https://www.grzyby.pl/gatunki/Xerocomus_parasiticus.htm) |
| 84 | Kolczak obłączasty | *Hydnum repandum* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Kolczak_obłączasty) |
| 85 | Pieprznik trąbkowy | *Craterellus tubaeformis* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Pieprznik_trąbkowy), [api.checklistbank.org](https://api.checklistbank.org/dataset/3LR/nameusage/search?q=Craterellus%20tubaeformis) |
| 86 | Płomiennica zimowa | *Flammulina velutipes* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Płomiennica_zimowa), [api.checklistbank.org](https://api.checklistbank.org/dataset/3LR/nameusage/search?q=Flammulina%20velutipes) |
| 87 | Żółciak siarkowy | *Laetiporus sulphureus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Żółciak_siarkowy), [en.wiki](https://en.wikipedia.org/wiki/Laetiporus_sulphureus) |
| 88 | Flagowiec olbrzymi | *Meripilus giganteus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Flagowiec_olbrzymi), [grzyby.pl](https://www.grzyby.pl/gatunki/Meripilus_giganteus.htm), [en.wiki](https://en.wikipedia.org/wiki/Meripilus_giganteus) |
| 89 | Pieczarka leśna | *Agaricus sylvaticus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Pieczarka_leśna), [en.wiki](https://en.wikipedia.org/wiki/Agaricus_sylvaticus), [api.checklistbank.org](https://api.checklistbank.org/dataset/3LR/nameusage/search?q=Agaricus%20sylvaticus) |
| 90 | Hełmówka jadowita | *Galerina marginata* | śmiertelny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Hełmówka_jadowita), [en.wiki](https://en.wikipedia.org/wiki/Galerina_marginata) |
| 91 | Muchomor jadowity | *Amanita virosa* | śmiertelny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Muchomor_jadowity), [grzyby.pl](https://www.grzyby.pl/gatunki/Amanita_virosa.htm) |
| 92 | Gąska tygrysia | *Tricholoma pardinum* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Gąska_tygrysia) |
| 93 | Piestrzenica olbrzymia | *Discina gigas* | trujący | – | [pl.wiki](https://pl.wikipedia.org/wiki/Piestrzenica_olbrzymia), [en.wiki](https://en.wikipedia.org/wiki/Gyromitra_gigas), [grzyby.pl](https://www.grzyby.pl/gatunki/Gyromitra_gigas.htm), [api.checklistbank.org](https://api.checklistbank.org/dataset/3LR/nameusage/search?q=Gyromitra%20gigas) |
| 94 | Naparstniczka czeska | *Verpa bohemica* | trujący | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Naparstniczka_czeska), [en.wiki](https://en.wikipedia.org/wiki/Verpa_bohemica), [grzyby.pl](https://www.grzyby.pl/gatunki/Ptychoverpa_bohemica.htm), [api.checklistbank.org](https://api.checklistbank.org/dataset/3LR/nameusage/search?q=Verpa%20bohemica) |
| 95 | Czarka austriacka | *Sarcoscypha austriaca* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Czarka_austriacka), [grzyby.pl](https://www.grzyby.pl/gatunki/Sarcoscypha_austriaca.htm) |
| 96 | Sromotnik bezwstydny | *Phallus impudicus* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Sromotnik_bezwstydny), [grzyby.pl](https://www.grzyby.pl/gatunki/Phallus_impudicus.htm) |
| 97 | Gwiazdosz frędzelkowany | *Geastrum fimbriatum* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Gwiazdosz_frędzelkowany) |
| 98 | Zasłonak fioletowy | *Cortinarius violaceus* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Zasłonak_fioletowy), [grzyby.pl](https://www.grzyby.pl/gatunki/Cortinarius_violaceus.htm) |
| 99 | Błyskoporek podkorowy | *Inonotus obliquus* | niejadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Błyskoporek_podkorowy), [grzyby.pl](https://www.grzyby.pl/gatunki/Inonotus_obliquus.htm), [en.wiki](https://en.wikipedia.org/wiki/Chaga_mushroom) |
| 100 | Borowik żółtobrązowy | *Butyriboletus appendiculatus* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Borowik_żółtobrązowy), [grzyby.pl](https://www.grzyby.pl/gatunki/Boletus_appendiculatus.htm), [en.wiki](https://en.wikipedia.org/wiki/Butyriboletus_appendiculatus), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 101 | Borowik korzeniasty | *Caloboletus radicans* | trujący | ścisła | [pl.wiki](https://pl.wikipedia.org/wiki/Borowik_korzeniasty), [grzyby.pl](https://www.grzyby.pl/gatunki/Boletus_radicans.htm), [en.wiki](https://en.wikipedia.org/wiki/Caloboletus_radicans), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 102 | Szyszkowiec łuskowaty | *Strobilomyces strobilaceus* | jadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Szyszkowiec_łuskowaty), [grzyby.pl](https://www.grzyby.pl/gatunki/Strobilomyces_strobilaceus.htm), [en.wiki](https://en.wikipedia.org/wiki/Strobilomyces_strobilaceus), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 103 | Ozorek dębowy | *Fistulina hepatica* | jadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Ozorek_dębowy), [grzyby.pl](https://www.grzyby.pl/gatunki/Fistulina_hepatica.htm), [en.wiki](https://en.wikipedia.org/wiki/Fistulina_hepatica), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 104 | Lakownica żółtawa | *Ganoderma lucidum* | niejadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Lakownica_żółtawa), [grzyby.pl](https://www.grzyby.pl/gatunki/Ganoderma_lucidum.htm), [pl.wiki](https://pl.wikipedia.org/wiki/Lakownica_spłaszczona), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 105 | Smardz stożkowaty | *Morchella conica* | jadalny | częściowa | [grzyby.pl](https://www.grzyby.pl/gatunki/Morchella_conica.htm), [pl.wiki](https://pl.wikipedia.org/wiki/Smardz_wyniosły), [en.wiki](https://en.wikipedia.org/wiki/Morchella_conica), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 106 | Smardz półwolny | *Morchella semilibera* | jadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Smardz_półwolny), [pl.wiki](https://pl.wikipedia.org/wiki/Naparstniczka_czeska), [en.wiki](https://en.wikipedia.org/wiki/Verpa_bohemica), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 107 | Siatkoblaszek maczugowaty | *Gomphus clavatus* | jadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Siatkoblaszek_maczugowaty), [grzyby.pl](https://www.grzyby.pl/gatunki/Gomphus_clavatus.htm), [en.wiki](https://en.wikipedia.org/wiki/Gomphus_clavatus), [pl.wiki](https://pl.wikipedia.org/wiki/Buławka_obcięta), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 108 | Okratek australijski | *Clathrus archeri* | niejadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Okratek_australijski), [grzyby.pl](https://www.grzyby.pl/gatunki/Clathrus_archeri.htm), [pl.wiki](https://pl.wikipedia.org/wiki/Clathrus_ruber) |
| 109 | Zasłonak rudawy | *Cortinarius rubellus* | śmiertelny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Zasłonak_rudawy), [grzyby.pl](https://www.grzyby.pl/gatunki/Cortinarius_rubellus.htm), [en.wiki](https://en.wikipedia.org/wiki/Cortinarius_rubellus) |
| 110 | Czubajeczka brązowoczerwona | *Lepiota brunneoincarnata* | śmiertelny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Lepiota_brunneoincarnata), [grzyby.pl](https://www.grzyby.pl/gatunki/Lepiota_brunneoincarnata.htm), [en.wiki](https://en.wikipedia.org/wiki/Lepiota_brunneoincarnata) |
| 111 | Purchawica olbrzymia | *Calvatia gigantea* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Purchawica_olbrzymia), [grzyby.pl](https://www.grzyby.pl/gatunki/Langermannia_gigantea.htm), [en.wiki](https://en.wikipedia.org/wiki/Calvatia_gigantea), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 112 | Krążkówka żyłkowana | *Disciotis venosa* | jadalny | ścisła | [pl.wiki](https://pl.wikipedia.org/wiki/Krążkówka_żyłkowana), [grzyby.pl](https://www.grzyby.pl/gatunki/Disciotis_venosa.htm), [en.wiki](https://en.wikipedia.org/wiki/Disciotis_venosa), [pl.wiki](https://pl.wikipedia.org/wiki/Gyromitra_ancilis), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 113 | Gwiazdosz czteropromienny | *Geastrum quadrifidum* | niejadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Gwiazdosz_czteropromienny), [grzyby.pl](https://www.grzyby.pl/gatunki/Geastrum_quadrifidum.htm), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 114 | Kolczakówka piekąca | *Hydnellum peckii* | niejadalny | ścisła | [pl.wiki](https://pl.wikipedia.org/wiki/Kolczakówka_piekąca), [grzyby.pl](https://www.grzyby.pl/gatunki/Hydnellum_peckii.htm), [en.wiki](https://en.wikipedia.org/wiki/Hydnellum_peckii), [grzyby.pl](https://www.grzyby.pl/gatunki/Hydnellum_ferrugineum.htm), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 115 | Soplówka bukowa | *Hericium coralloides* | jadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Soplówka_bukowa), [grzyby.pl](https://www.grzyby.pl/gatunki/Hericium_coralloides.htm), [en.wiki](https://en.wikipedia.org/wiki/Hericium_coralloides), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 116 | Żagiew wielogłowa | *Polyporus umbellatus* | jadalny | częściowa | [pl.wiki](https://pl.wikipedia.org/wiki/Żagiew_wielogłowa), [en.wiki](https://en.wikipedia.org/wiki/Polyporus_umbellatus), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 117 | Gwiazda wieloporowa | *Myriostoma coliforme* | niejadalny | ścisła | [pl.wiki](https://pl.wikipedia.org/wiki/Myriostoma_coliforme), [grzyby.pl](https://www.grzyby.pl/gatunki/Myriostoma_coliforme.htm), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 118 | Koronica ozdobna | *Sarcosphaera coronaria* | śmiertelny | ścisła | [pl.wiki](https://pl.wikipedia.org/wiki/Koronica_ozdobna), [grzyby.pl](https://www.grzyby.pl/gatunki/Sarcosphaera_coronaria.htm), [en.wiki](https://en.wikipedia.org/wiki/Sarcosphaera_coronaria), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |
| 119 | Żyłkowiec różowawy | *Rhodotus palmatus* | niejadalny | ścisła | [pl.wiki](https://pl.wikipedia.org/wiki/Żyłkowiec_różowawy), [eli.gov.pl](https://eli.gov.pl/eli/DU/2014/1408/ogl) |
| 120 | Trufla letnia | *Tuber aestivum* | jadalny | – | [pl.wiki](https://pl.wikipedia.org/wiki/Trufla_letnia), [grzyby.pl](https://www.grzyby.pl/gatunki/Tuber_aestivum.htm), [en.wiki](https://en.wikipedia.org/wiki/Tuber_aestivum), [lasy.gov.pl](https://www.lasy.gov.pl/pl/informacje/publikacje/do-poczytania/polskie-trufle-skarb-odzyskany-2/polskie-trufle-skarb-odzyskany.pdf/@@download/file/POLSKIE%20TRUFLE%20SKARB%20ODZYSKANY.pdf), [pjoes.com](https://www.pjoes.com/Soil-Properties-Conducive-to-the-Formation-nof-Tuber-aestivum-Vitt-Fruiting-Bodies,89588,0,2.html), [pl.wiki](https://pl.wikipedia.org/wiki/Elaphomyces_granulatus), [isap.sejm.gov.pl](https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU20140001408/O/D20141408.pdf) |

