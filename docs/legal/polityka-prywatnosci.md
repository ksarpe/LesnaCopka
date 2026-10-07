<!-- Plik generowany z src/data/legal.ts (npm run legal:md) – nie edytuj ręcznie. -->

# Polityka prywatności aplikacji Grzybobranie

> **Szkic – wymaga weryfikacji prawnika przed publikacją**

Wersja robocza z 7 października 2026.

Wyjaśniamy, jakie dane przetwarza aplikacja Grzybobranie (dalej: „Aplikacja”), po co, jak długo i jakie masz prawa. Aplikację projektujemy tak, żeby wiedzieć o Tobie jak najmniej.

> **W skrócie**
>
> - Dokładna lokalizacja zostaje na telefonie. Gminę wykrywamy offline, na urządzeniu – na serwer trafia tylko gmina, nigdy współrzędne GPS.
> - Ślad trasy wyprawy jest tylko w pamięci telefonu i znika po zamknięciu Aplikacji.
> - Wpisy z wypraw inni widzą dopiero po 24 godzinach – z dokładnością do gminy albo przybliżonej trasy.
> - Konto jest anonimowe – adres e-mail podajesz tylko, jeśli chcesz zabezpieczyć Konto; nie prosimy o telefon ani hasło.
> - Ze zdjęć usuwamy metadane (w tym położenie), zanim je zapiszemy lub wyślemy.
> - Nie wyświetlamy reklam, nie używamy narzędzi śledzących i nie sprzedajemy danych.

## 1. Administrator danych

Administratorem Twoich danych osobowych jest [nazwa administratora], [adres] (dalej: „my”). Kontakt w sprawach danych osobowych: [adres e-mail kontaktowy]. [Jeśli zostanie wyznaczony inspektor ochrony danych – jego dane kontaktowe.]

## 2. Lokalizacja

Za Twoją zgodą (uprawnienie „Lokalizacja” w telefonie) Aplikacja odczytuje pozycję GPS – tylko wtedy, gdy jest otwarta na ekranie. Nie śledzimy Cię w tle.

- **Gmina** – wykrywamy ją na telefonie, bez internetu, z granic gmin zapisanych w Aplikacji (Państwowy Rejestr Granic).
- **Mapa okolicy i odległość do lasu** – liczone na telefonie z pobranych kafli mapy (punkt 3).
- **Prognoza grzybowa** – liczona na telefonie z danych pogodowych; do serwisu pogody trafia tylko przybliżona okolica, nie Twoja pozycja (punkt 3).
- **Dystans i trasa wyprawy** – punkty GPS trzymamy wyłącznie w pamięci operacyjnej telefonu; znikają po zamknięciu lub ponownym uruchomieniu Aplikacji. Nie zapisujemy ich w pamięci telefonu ani nie wysyłamy na serwer.
- **Publikacja wyprawy** – wpis zawiera gminę, dystans, czas i znaleziska, a zamiast trasy tylko informację „trasa przybliżona” albo „trasa ukryta”. Mapa w podsumowaniu wyprawy pokazuje trasę uproszczoną i bez okolic startu i mety.

Na serwer wysyłamy tylko gminę (wyprawy, znaleziska i gminę domową) oraz przebyty dystans. Zgodę na lokalizację możesz w każdej chwili cofnąć w ustawieniach telefonu – rozpoczęcie wyprawy wymaga jednak lokalizacji.

## 3. Mapa okolicy i pogoda (OpenFreeMap, Open-Meteo)

Mapę okolicy Aplikacja rysuje z kafli mapy pobieranych z serwerów OpenFreeMap (dane © OpenStreetMap). Zapytanie zawiera tylko numery kafli – obszar o boku kilku kilometrów wokół Ciebie – a nie Twoje współrzędne. Jak przy każdym połączeniu z internetem, serwer kafli widzi adres IP urządzenia i podstawowe dane techniczne zapytania. [Do weryfikacji: rola dostawcy kafli (odrębny administrator czy podmiot przetwarzający) i jego polityka prywatności.]

Kafle mapy zapisujemy na telefonie, żeby mapa działała w lesie bez zasięgu: oglądane okolice (do ok. 30 MB – najdawniej używane usuwamy same) i obszary, które sam pobierzesz na offline (okolica albo cała gmina). Przy obszarze offline zapisujemy jego nazwę i zasięg z dokładnością do kafla mapy (ok. 3 km) – nie Twoją pozycję. Nic z tego nie trafia na nasz serwer; usuniesz to w Ustawieniach → Mapy offline.

Prognozę grzybową Aplikacja liczy na telefonie z danych pogodowych Open-Meteo.com (licencja CC BY 4.0). Zapytanie zawiera tylko współrzędne zaokrąglone do 0,1° – obszar ok. 11 × 7 km – a nie Twoją pozycję. Pogodę dla tego obszaru telefon pamięta do 3 godzin, żeby nie pytać ponownie. Serwer Open-Meteo widzi adres IP urządzenia i podstawowe dane techniczne zapytania. [Do weryfikacji: rola Open-Meteo i jego polityka prywatności; darmowe API jest tylko do użytku niekomercyjnego – przy płatnej aplikacji lub reklamach potrzebna subskrypcja.]

## 4. Aparat i zdjęcia

Za Twoją zgodą (uprawnienie „Aparat”) Aplikacja używa aparatu do skanu grzyba i zdjęcia znaleziska, a jeśli chcesz – do zdjęcia profilowego. Zdjęcie profilowe możesz też wybrać z galerii: systemowy wybór zdjęć udostępnia Aplikacji tylko wskazane zdjęcie. Aplikacja nie nagrywa filmów ani dźwięku.

- Zdjęcia zmniejszamy i zapisujemy od nowa, co usuwa metadane EXIF – w tym współrzędne GPS, datę wykonania i model telefonu.
- **Zdjęcia znalezisk** przechowujemy na telefonie, a po synchronizacji także w prywatnym magazynie plików powiązanym z Twoim Kontem – dostęp do nich masz tylko Ty. [Docelowo także serwerowa funkcja rozpoznawania gatunku – do uzupełnienia, gdy powstanie.]
- **Okładka wpisu** (zdjęcie znaleziska dołączone do opublikowanej wyprawy) i **zdjęcie profilowe** są publiczne: widzą je inni Użytkownicy, a technicznie może je otworzyć każdy, kto zna ich losowy adres.

## 5. Konto i profil

Przy pierwszym uruchomieniu tworzymy anonimowe Konto: losowy identyfikator i klucz sesji zapisany na telefonie. Nie prosimy o telefon ani hasło. Zapisujemy też, którą wersję regulaminu i Polityki prywatności zaakceptowałeś i kiedy, oraz kiedy skończyłeś pierwszą konfigurację Aplikacji.

- **Adres e-mail** (tylko jeśli zabezpieczysz Konto) – do logowania jednorazowym kodem, także na innym telefonie. Inni Użytkownicy go nie widzą; nie wysyłamy na niego reklam ani newslettera.
- **Nick** oraz **imię i nazwisko** (może to być pseudonim) – widoczne dla innych Użytkowników, np. jako autor wpisu; wyszukiwarka znajomych znajdzie Cię po nicku i po imieniu.
- **Gmina domowa** – do rankingu gmin; inni widzą ją w Twoim profilu.
- **Avatar** – motyw graficzny albo zdjęcie (punkt 4).
- **Opis „O mnie”** – zostaje na telefonie.

## 6. Dane gry i społeczności

Żeby gra działała, liczyła rankingi i pozwalała dzielić się wyprawami, na serwerze zapisujemy:

- wyprawy: gmina, czas rozpoczęcia i zakończenia, dystans, punkty;
- znaleziska: gatunek, rzadkość, szacowane wymiary i waga, gmina, czas, wynik rozpoznania;
- postęp: XP, poziom, seria dni, atlas gatunków, odznaki, osiągnięcia, zadania, przyjęte wyzwania, obserwowane gminy;
- społeczność: wpisy, komentarze, reakcje „Darz grzyb!”, znajomi i zaproszenia, ukryte wpisy, zablokowani Użytkownicy i Twoje zgłoszenia.

Inni Użytkownicy widzą Twój profil (nick, imię lub pseudonim, avatar, poziom, gminę domową, liczbę wypraw, grzybów i gatunków) oraz Twoje wpisy – dopiero 24 godziny po publikacji. Statystyki i rankingi gmin to zbiorcze wyliczenia ze znalezisk sprzed co najmniej 24 godzin; w rekordach gminy pokazujemy nick autora rekordowego okazu.

## 7. Powiadomienia

Przypomnienia i powiadomienia (seria dni, wpis widoczny dla innych, reakcje i komentarze znajomych, podsumowanie tygodnia) planuje sam telefon – to powiadomienia lokalne. Nie wysyłamy powiadomień push z serwera i nie zbieramy tokenów push. O nowe reakcje i komentarze Aplikacja pyta serwer, gdy jest otwarta. Zgodę i rodzaje powiadomień zmienisz w Ustawieniach Aplikacji i telefonu.

## 8. Dane na telefonie i dane techniczne

- Na telefonie zapisujemy stan gry, ustawienia, zdjęcia, centrum powiadomień i kolejkę zdarzeń do wysłania. „Wyczyść dane” w Ustawieniach usuwa je z telefonu (nie usuwa Konta na serwerze), a „Usuń konto” – z telefonu i z serwera (punkt 12). Mapy offline i pamięć podręczna mapy (punkt 3) nie są danymi gry ani Konta – zostają po „Wyczyść dane” i „Usuń konto”; usuwasz je w Ustawieniach → Mapy offline.
- Serwer zapisuje dane techniczne połączeń (m.in. adres IP, czas i rodzaj zapytania) – żeby zapewnić bezpieczeństwo i usuwać błędy.
- Błędy Aplikacji trafiają obecnie tylko do dziennika systemowego telefonu. [Jeśli zostanie dodane narzędzie do raportowania błędów, np. Sentry – uzupełnić: zakres danych, dostawca, okres przechowywania.]
- Nie używamy reklam, analityki marketingowej ani narzędzi śledzących.

## 9. Cele i podstawy prawne

- świadczenie usługi zgodnie z regulaminem – Konto, gra, synchronizacja, funkcje społecznościowe (art. 6 ust. 1 lit. b RODO);
- bezpieczeństwo, zapobieganie nadużyciom i oszustwom w grze, moderacja treści, statystyki gmin oraz ustalanie, dochodzenie i obrona roszczeń – nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO);
- obowiązki prawne, np. rozpatrywanie reklamacji i zgłoszeń nielegalnych treści (art. 6 ust. 1 lit. c RODO);
- dostęp do lokalizacji, aparatu, zdjęć i powiadomień – wyłącznie po udzieleniu uprawnienia w telefonie, które możesz w każdej chwili cofnąć. [Do weryfikacji: zgoda na dostęp do informacji w urządzeniu – ustawa Prawo komunikacji elektronicznej.]

Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, które wywoływałyby skutki prawne (art. 22 RODO). Rozpoznanie gatunku i rankingi są elementami gry.

## 10. Odbiorcy danych

- **Supabase** – hosting bazy danych, kont i plików jako podmiot przetwarzający, na podstawie umowy powierzenia (DPA). Dane przechowujemy na serwerach w Unii Europejskiej: [region do wybrania, np. Frankfurt]. [Do weryfikacji: ewentualny dostęp z USA i podstawa transferu – EU-US Data Privacy Framework albo standardowe klauzule umowne.]
- **OpenFreeMap** – serwer kafli mapy (adres IP i numery kafli, punkt 3).
- **Open-Meteo** – serwis pogody do prognozy grzybowej (adres IP i współrzędne zaokrąglone do 0,1°, punkt 3).
- **Dostawca poczty e-mail** – wysyła kody logowania na adres Konta zabezpieczonego e-mailem. [Do uzupełnienia: dostawca serwera poczty (SMTP) i podstawa przekazania.]
- **Inni Użytkownicy** – w zakresie opisanym w punktach 5 i 6.
- **Apple i Google** – sklepy z aplikacjami i systemy telefonów przetwarzają dane według własnych zasad (np. przy pobraniu Aplikacji); nie przekazujemy im danych z gry.
- Organy publiczne – tylko wtedy, gdy wymaga tego prawo.

## 11. Jak długo przechowujemy dane

- pozycja GPS i ślad wyprawy – tylko w pamięci telefonu, do zamknięcia Aplikacji;
- pogoda dla przybliżonej okolicy (obszar 0,1°) – w pamięci telefonu do 3 godzin;
- kafle mapy na telefonie – pamięć podręczna do ok. 30 MB (najdawniej używane usuwamy same), mapy offline – do usunięcia w Ustawieniach → Mapy offline albo odinstalowania Aplikacji;
- Konto, profil, dane gry i Treści – do usunięcia Konta; Konto nieaktywne przez [okres] możemy usunąć [do decyzji];
- zgłoszenia i decyzje moderacyjne – [okres] od rozpatrzenia;
- dane techniczne połączeń (logi serwera) – [okres];
- dane na telefonie – do użycia „Wyczyść dane” albo odinstalowania Aplikacji.

Po usunięciu Konta w Aplikacji („Usuń konto”) od razu kasujemy z serwera Twoje dane gry, wpisy, komentarze, reakcje, znajomości, zdjęcia i samo Konto (także adres e-mail). Z kopii zapasowych dane znikają w ciągu [okres]. Zostać mogą zbiorcze statystyki gmin, z których nie da się Cię zidentyfikować.

## 12. Twoje prawa

Na zasadach z RODO masz prawo do:

- dostępu do swoich danych i otrzymania ich kopii (art. 15);
- sprostowania danych (art. 16) – nick, imię i gminę domową poprawisz sam w Ustawieniach → Edytuj profil;
- usunięcia danych (art. 17);
- ograniczenia przetwarzania (art. 18);
- przenoszenia danych – eksportu w formacie do odczytu maszynowego (art. 20);
- sprzeciwu wobec przetwarzania opartego na naszym prawnie uzasadnionym interesie (art. 21);
- cofnięcia uprawnień (lokalizacja, aparat, zdjęcia, powiadomienia) w ustawieniach telefonu – w każdej chwili;
- wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa, uodo.gov.pl).

Kopię swoich danych (plik JSON do odczytu maszynowego) pobierzesz sam w Ustawieniach → „Pobierz moje dane”, a Konto usuniesz w Ustawieniach → „Usuń konto”. W innych sprawach napisz na [adres e-mail kontaktowy] i podaj swój nick oraz identyfikator Konta (Ustawienia → Konto i logowanie) – pomogą nam potwierdzić, że Konto należy do Ciebie. Odpowiemy w ciągu miesiąca.

## 13. Dzieci

Aplikacja jest przeznaczona dla osób, które ukończyły 16 lat. Osoby młodsze mogą z niej korzystać tylko za zgodą rodzica lub opiekuna prawnego. Jeśli dowiemy się, że przetwarzamy dane dziecka poniżej 16 lat bez takiej zgody, usuniemy je.

## 14. Bezpieczeństwo

Połączenia z serwerem są szyfrowane (HTTPS). Dostęp do danych na serwerze ograniczają reguły bezpieczeństwa bazy danych: prywatne dane widzi tylko właściciel Konta, a publiczne statystyki są wyłącznie zbiorcze. Zbieramy tylko dane potrzebne do działania gry.

## 15. Zmiany polityki

O istotnych zmianach polityki prywatności poinformujemy w Aplikacji. Aktualna wersja jest zawsze dostępna w Ustawieniach → Informacje prawne.

Polityka obowiązuje od [data wejścia w życie].
