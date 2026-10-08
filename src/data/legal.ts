/**
 * Regulamin i polityka prywatności – SZKICE do weryfikacji prawnej.
 *
 * Jedno źródło prawdy: ekrany Ustawienia → Informacje prawne (`app/ustawienia/regulamin.tsx`,
 * `app/ustawienia/prywatnosc.tsx`) renderują te dane, a pliki `docs/legal/*.md` są z nich generowane
 * (`npm run legal:md`; test `src/data/__tests__/legal.test.ts` pilnuje zgodności). Zmieniaj treść tylko tutaj.
 *
 * Treść opisuje, jak aplikacja działa naprawdę (README → „Prywatność”, docs/backend.md). Zmiana działania
 * (np. logowanie, push z serwera, model rozpoznawania, raportowanie błędów) = zmiana tych tekstów.
 * Miejsca do uzupełnienia są w nawiasach kwadratowych: [nazwa administratora], [adres e-mail kontaktowy]…
 * Plik bez importów – czyta go też skrypt `scripts/gen-legal.ts` (tsx, bez aliasów `@/`).
 */

export const LEGAL_DRAFT_NOTICE = 'Szkic – wymaga weryfikacji prawnika przed publikacją';

/** Fragment tekstu – `**pogrubienie**` w treści (jak w Markdown). */
export interface TextRun {
  text: string;
  bold: boolean;
}

export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  /** Wyróżniona ramka: warn = bezpieczeństwo (żółta), info = skrót (zielona). */
  | { kind: 'box'; tone: 'warn' | 'info'; title: string; text?: string; items?: string[] };

export interface LegalSection {
  title: string;
  blocks: LegalBlock[];
}

export type LegalDocId = 'regulamin' | 'prywatnosc';

export interface LegalDoc {
  id: LegalDocId;
  /** Krótki tytuł (nagłówek ekranu, wiersz w Ustawieniach). */
  title: string;
  fullTitle: string;
  /** Plik w docs/legal/. */
  file: string;
  /** Data ostatniej zmiany szkicu (RRRR-MM-DD). */
  updated: string;
  intro: LegalBlock[];
  sections: LegalSection[];
}

const p = (text: string): LegalBlock => ({ kind: 'p', text });
const list = (...items: string[]): LegalBlock => ({ kind: 'list', items });

/**
 * Najważniejsza zasada bezpieczeństwa (ramka na początku regulaminu i na ekranie powitalnym – app/onboarding.tsx).
 * Jedno źródło tekstu.
 */
export const SAFETY_NOTICE = {
  title: 'Najważniejsze: Aplikacja nie mówi, czy grzyb jest jadalny',
  text:
    'Rozpoznanie gatunku i opisy w Aplikacji są orientacyjne i mogą być błędne. Nie jedz żadnego grzyba wyłącznie ' +
    'na podstawie Aplikacji – w razie wątpliwości pokaż go grzyboznawcy (klasyfikatorowi grzybów), np. w stacji ' +
    'sanitarno-epidemiologicznej.',
} as const;

/** Zasady bezpieczeństwa z § 4 regulaminu (ekran powitalny linkuje do nich). */
export const SAFETY_RULES: readonly string[] = [
  'Nie jedz grzyba tylko dlatego, że Aplikacja tak go rozpoznała. Zbieraj wyłącznie gatunki, które znasz na pewno.',
  'Każdy grzyb, co do którego masz wątpliwości, przed przyrządzeniem pokaż grzyboznawcy (klasyfikatorowi ' +
    'grzybów) – porad udzielają m.in. stacje sanitarno-epidemiologiczne (sanepid).',
  'Gatunków trujących i śmiertelnie trujących nie zbieraj – Aplikacja pozwala zapisać je tylko jako zdjęcie ' +
    'w atlasie.',
  'Przy podejrzeniu zatrucia grzybami natychmiast zadzwoń pod numer alarmowy 112 albo jedź na SOR. Zachowaj ' +
    'resztki grzybów i potrawy – pomogą ustalić gatunek.',
];

/** Zawsze widoczna notka przy wyniku rozpoznania (Analiza, Nagroda – AiSafetyNote w src/components/SpeciesSheet.tsx). */
export const AI_RESULT_NOTICE = 'Rozpoznanie AI może się mylić – nie jedz grzyba tylko na podstawie aplikacji.';

export const REGULAMIN: LegalDoc = {
  id: 'regulamin',
  title: 'Regulamin',
  fullTitle: 'Regulamin aplikacji Grzybobranie',
  file: 'regulamin.md',
  updated: '2026-10-08',
  intro: [
    p(
      'Regulamin określa zasady korzystania z aplikacji mobilnej Grzybobranie – gry i dziennika grzybobrania. ' +
        'Przy pierwszym uruchomieniu Aplikacja prosi o akceptację regulaminu i Polityki prywatności – bez niej nie ' +
        'można z niej korzystać. O tym, jak chronimy Twoje dane, piszemy w Polityce prywatności.',
    ),
    { kind: 'box', tone: 'warn', title: SAFETY_NOTICE.title, text: SAFETY_NOTICE.text },
  ],
  sections: [
    {
      title: '§ 1. Postanowienia ogólne',
      blocks: [
        p(
          'Aplikację Grzybobranie (dalej: „Aplikacja”) udostępnia [nazwa administratora], [adres], [NIP / KRS] ' +
            '(dalej: „Administrator”, „my”).',
        ),
        p('Kontakt w sprawach Aplikacji, regulaminu, reklamacji i zgłoszeń: [adres e-mail kontaktowy].'),
        p(
          'Regulamin jest regulaminem świadczenia usług drogą elektroniczną w rozumieniu ustawy z dnia 18 lipca 2002 r. ' +
            'o świadczeniu usług drogą elektroniczną.',
        ),
        list(
          '**Użytkownik** – osoba korzystająca z Aplikacji.',
          '**Konto** – konto Użytkownika tworzone przy pierwszym uruchomieniu Aplikacji – anonimowe, dopóki ' +
            'Użytkownik nie przypisze do niego adresu e-mail.',
          '**Wyprawa** – zapis grzybobrania: gmina, czas, dystans i znaleziska.',
          '**Treści** – to, co Użytkownik publikuje lub zapisuje w Aplikacji: nick, imię i nazwisko (lub pseudonim), ' +
            'zdjęcia, opis profilu, wpisy z wypraw, komentarze i reakcje.',
        ),
      ],
    },
    {
      title: '§ 2. Czym jest Aplikacja',
      blocks: [
        p(
          'Aplikacja pozwala zapisywać wyprawy na grzyby, skanować grzyby aparatem, zbierać punkty doświadczenia (XP), ' +
            'odznaki i osiągnięcia, prowadzić atlas gatunków, porównywać gminy w rankingach i dzielić się wyprawami ' +
            'ze znajomymi.',
        ),
        p('Korzystanie z Aplikacji jest bezpłatne. [Do potwierdzenia – Aplikacja nie ma płatności ani reklam.]'),
        p(
          'Do pełnego działania potrzebny jest smartfon z systemem iOS lub Android, z aparatem i odbiornikiem GPS, ' +
            'a do synchronizacji, mapy okolicy i funkcji społecznościowych – dostęp do internetu. W lesie bez zasięgu ' +
            'gra działa offline, a dane wysyłają się po odzyskaniu połączenia.',
        ),
        p(
          'Gatunek grzyba rozpoznaje ze zdjęcia model sztucznej inteligencji (Claude firmy Anthropic): po naciśnięciu ' +
            'spustu zdjęcie trafia przez nasz serwer do modelu wyłącznie w celu rozpoznania. Wynik jest orientacyjny ' +
            'i może być błędny (§ 4). Gdy na zdjęciu nie widać grzyba albo ujęcie jest niewyraźne, Aplikacja nie zapisuje ' +
            'znaleziska. Liczba rozpoznań jest ograniczona (obecnie 60 na dobę), a bez internetu rozpoznanie nie działa.',
        ),
      ],
    },
    {
      title: '§ 3. Konto i profil',
      blocks: [
        p(
          'Przy pierwszym uruchomieniu Aplikacja tworzy anonimowe Konto – bez adresu e-mail, numeru telefonu i hasła. ' +
            'Konto jest powiązane z instalacją Aplikacji na danym telefonie.',
        ),
        p(
          'Konto możesz zabezpieczyć adresem e-mail (Ustawienia → Konto i logowanie): wyślemy na niego jednorazowy kod, ' +
            'a po jego wpisaniu zalogujesz się na Konto kodem z e-maila także na innym telefonie. Bez adresu e-mail ' +
            'usunięcie Aplikacji albo jej danych oznacza utratę dostępu do Konta – nie ma loginu, którym dałoby się je ' +
            'odzyskać. [Do uzupełnienia, gdy pojawi się logowanie Sign in with Apple / Google.]',
        ),
        p(
          'W profilu możesz ustawić nick, imię i nazwisko (może to być pseudonim), gminę domową, avatar i krótki opis. ' +
            'Nick, imię i nazwisko oraz avatar widzą inni Użytkownicy. Nie podszywaj się pod inne osoby i nie używaj ' +
            'nicków obraźliwych ani wprowadzających w błąd.',
        ),
        p(
          'Możesz w każdej chwili przestać korzystać z Aplikacji i usunąć Konto wraz z danymi – sam, w Ustawieniach ' +
            '(„Usuń konto”), albo pisząc na [adres e-mail kontaktowy]. Kopię swoich danych pobierzesz w Ustawieniach ' +
            '(„Pobierz moje dane”).',
        ),
        p(
          'Z Aplikacji mogą korzystać osoby, które ukończyły 16 lat – potwierdzasz to przy pierwszym uruchomieniu. ' +
            'Osoba młodsza może z niej korzystać wyłącznie za zgodą rodzica lub opiekuna prawnego.',
        ),
      ],
    },
    {
      title: '§ 4. Bezpieczeństwo – grzyby',
      blocks: [
        {
          kind: 'box',
          tone: 'warn',
          title: 'Aplikacja nigdy nie rozstrzyga o jadalności grzyba',
          text:
            'Wynik rozpoznania, oznaczenia „jadalny”, „niejadalny” i „trujący”, informacje o sobowtórach i wskazówki ' +
            'mają charakter wyłącznie informacyjny i edukacyjny. Mogą być błędne – zdjęcie nie oddaje wszystkich cech ' +
            'grzyba (zapachu, przebarwień, budowy podstawy trzonu).',
        },
        list(...SAFETY_RULES),
        p(
          'W granicach dopuszczalnych przez prawo nie odpowiadamy za skutki zbierania, przyrządzania i spożycia grzybów ' +
            'ani za decyzje podjęte wyłącznie na podstawie informacji z Aplikacji. [Do weryfikacji przez prawnika: ' +
            'zakres wyłączenia odpowiedzialności wobec konsumentów.]',
        ),
      ],
    },
    {
      title: '§ 5. Zasady w lesie',
      blocks: [
        p('Korzystając z Aplikacji, przestrzegaj przepisów i zasad obowiązujących w lesie, w szczególności:'),
        list(
          'nie wchodź na tereny objęte stałym lub okresowym zakazem wstępu (np. uprawy leśne, ostoje zwierząt, obszary ' +
            'oznaczone tablicami zakazu, lasy zamknięte z powodu zagrożenia pożarowego);',
          'w parkach narodowych i rezerwatach przyrody zbieraj grzyby tylko tam, gdzie jest to wyraźnie dozwolone;',
          'nie zrywaj ani nie niszcz grzybów objętych ochroną gatunkową;',
          'nie rozkopuj ściółki, nie niszcz grzybni i zostawiaj w lesie grzyby trujące i niejadalne;',
          'nie wjeżdżaj do lasu pojazdem tam, gdzie jest to zabronione, i nie zostawiaj śmieci.',
        ),
        p(
          'Aplikacja nie jest nawigacją ani mapą turystyczną. Zanim wyjdziesz do lasu, powiedz komuś, dokąd idziesz, ' +
            'i zadbaj o naładowany telefon. Idąc, patrz pod nogi, a nie w ekran.',
        ),
      ],
    },
    {
      title: '§ 6. Treści i zasady społeczności',
      blocks: [
        p('Odpowiadasz za Treści, które publikujesz. Publikuj tylko to, do czego masz prawa (np. własne zdjęcia).'),
        p('Zabronione jest w szczególności:'),
        list(
          'nękanie, obrażanie innych i grożenie im, mowa nienawiści i treści dyskryminujące;',
          'treści wulgarne, o charakterze seksualnym, przedstawiające przemoc lub naruszające prawo;',
          'ujawnianie cudzych miejsc grzybowych, lokalizacji lub danych osobowych innych osób bez ich zgody – także ' +
            'zdjęć, na których widać inne osoby;',
          'zachęcanie do łamania prawa, np. zbierania w rezerwatach, zbierania gatunków chronionych czy niszczenia przyrody;',
          'świadome podawanie fałszywych informacji o jadalności grzybów;',
          'spam, reklama, podszywanie się pod inne osoby lub pod Administratora;',
          'oszukiwanie w grze – fałszowanie lokalizacji, automatyzacja, ingerencja w działanie Aplikacji lub serwera.',
        ),
        p(
          'Publikując Treści, udzielasz nam nieodpłatnej, niewyłącznej licencji na ich przechowywanie, zwielokrotnianie ' +
            'i wyświetlanie innym Użytkownikom w Aplikacji – w zakresie potrzebnym do jej działania i na czas, w którym ' +
            'Treść jest opublikowana.',
        ),
        p(
          'Wpis z wyprawy inni widzą dopiero 24 godziny po publikacji – z dokładnością do gminy albo przybliżonej trasy, ' +
            'bez dokładnej lokalizacji. Szczegóły – w Polityce prywatności.',
        ),
      ],
    },
    {
      title: '§ 7. Zgłoszenia i moderacja',
      blocks: [
        p(
          'Wpis zgłosisz z menu „⋯” przy wpisie („Zgłoś”), a komentarz – z menu komentarza („Zgłoś komentarz”). Wpisy, ' +
            'których nie chcesz oglądać, możesz ukryć. Treści niezgodne z prawem lub regulaminem możesz też zgłosić na ' +
            '[adres e-mail kontaktowy] – napisz, czego dotyczy zgłoszenie i dlaczego Twoim zdaniem narusza prawo ' +
            'lub regulamin.',
        ),
        p(
          'Innego Użytkownika możesz zablokować – w jego profilu, w menu „⋯” przy wpisie albo w menu komentarza. ' +
            'Nie zobaczycie wtedy nawzajem swoich wpisów, komentarzy ani reakcji, nie zaprosicie się do znajomych, ' +
            'a znajomość między Wami zostanie usunięta. Zablokowanych odblokujesz w Ustawieniach → Prywatność.',
        ),
        p(
          'Zgłoszenia rozpatrujemy bez zbędnej zwłoki, w ciągu [termin]. Treść naruszającą prawo lub regulamin możemy ' +
            'ukryć albo usunąć, a przy poważnych lub powtarzających się naruszeniach – czasowo zablokować albo usunąć Konto.',
        ),
        p(
          'O decyzji i jej powodach informujemy autora Treści i osobę zgłaszającą, o ile mamy z nimi kontakt (adres ' +
            'e-mail ma tylko Konto zabezpieczone e-mailem). Od decyzji możesz się odwołać na [adres e-mail kontaktowy] – odwołanie ' +
            'rozpatrzymy w ciągu [termin]. [Do weryfikacji: obowiązki z aktu o usługach cyfrowych (DSA) – punkt ' +
            'kontaktowy, uzasadnienie decyzji, wewnętrzny system rozpatrywania skarg.]',
        ),
      ],
    },
    {
      title: '§ 8. Punkty, odznaki i rankingi',
      blocks: [
        p(
          'XP, poziomy, odznaki, osiągnięcia i miejsca w rankingach to elementy gry. Nie mają wartości pieniężnej ' +
            'i nie można ich wymienić na pieniądze ani nagrody.',
        ),
        p(
          'Możemy korygować wyniki powstałe wskutek błędu lub oszustwa. Rankingi gmin uwzględniają wyprawy sprzed ' +
            'co najmniej 24 godzin – to element ochrony lokalizacji grzybiarzy.',
        ),
      ],
    },
    {
      title: '§ 9. Dostępność i zmiany',
      blocks: [
        p(
          'Staramy się, żeby Aplikacja działała bez przerw, ale mogą się zdarzać błędy, przerwy techniczne i zmiany ' +
            'funkcji. Gra i wykrywanie gminy działają bez internetu, a mapa okolicy – w obszarach pobranych wcześniej ' +
            'na telefon („Mapy offline”); pobieranie mapy, synchronizacja i funkcje społecznościowe wymagają połączenia.',
        ),
        p(
          'Możemy rozwijać Aplikację, zmieniać i wycofywać funkcje. O istotnych zmianach regulaminu poinformujemy ' +
            'w Aplikacji z wyprzedzeniem co najmniej [liczba] dni. Jeśli nie akceptujesz zmian, możesz przestać ' +
            'korzystać z Aplikacji i zażądać usunięcia Konta.',
        ),
      ],
    },
    {
      title: '§ 10. Reklamacje',
      blocks: [
        p(
          'Reklamacje dotyczące działania Aplikacji wysyłaj na [adres e-mail kontaktowy]. Opisz problem i podaj swój ' +
            'nick. Odpowiemy w ciągu 14 dni.',
        ),
        p(
          'Konsument może skorzystać z pozasądowych sposobów rozwiązywania sporów, np. z pomocy miejskiego lub ' +
            'powiatowego rzecznika konsumentów. [Do uzupełnienia przez prawnika: prawa konsumenta dotyczące usług ' +
            'cyfrowych.]',
        ),
      ],
    },
    {
      title: '§ 11. Postanowienia końcowe',
      blocks: [
        p(
          'W sprawach nieuregulowanych stosuje się prawo polskie. Regulamin nie wyłącza ani nie ogranicza praw, które ' +
            'przysługują konsumentom na podstawie bezwzględnie obowiązujących przepisów.',
        ),
        p(
          'Aplikacja korzysta z danych: granice gmin – Państwowy Rejestr Granic (GUGiK), lesistość – Bank Danych ' +
            'Lokalnych GUS, mapa okolicy – © OpenStreetMap (licencja ODbL), kafle OpenFreeMap / OpenMapTiles, ' +
            'prognoza pogody – Open-Meteo.com (licencja CC BY 4.0).',
        ),
        p('Regulamin obowiązuje od [data wejścia w życie].'),
      ],
    },
  ],
};

export const POLITYKA_PRYWATNOSCI: LegalDoc = {
  id: 'prywatnosc',
  title: 'Polityka prywatności',
  fullTitle: 'Polityka prywatności aplikacji Grzybobranie',
  file: 'polityka-prywatnosci.md',
  updated: '2026-10-08',
  intro: [
    p(
      'Wyjaśniamy, jakie dane przetwarza aplikacja Grzybobranie (dalej: „Aplikacja”), po co, jak długo i jakie masz ' +
        'prawa. Aplikację projektujemy tak, żeby wiedzieć o Tobie jak najmniej.',
    ),
    {
      kind: 'box',
      tone: 'info',
      title: 'W skrócie',
      items: [
        'Dokładna lokalizacja zostaje na telefonie. Gminę wykrywamy offline, na urządzeniu – na serwer trafia tylko ' +
          'gmina, nigdy współrzędne GPS.',
        'Ślad trasy wyprawy jest tylko w pamięci telefonu i znika po zamknięciu Aplikacji.',
        'Wpisy z wypraw inni widzą dopiero po 24 godzinach – z dokładnością do gminy albo przybliżonej trasy.',
        'Konto jest anonimowe – adres e-mail podajesz tylko, jeśli chcesz zabezpieczyć Konto; nie prosimy o telefon ' +
          'ani hasło.',
        'Ze zdjęć usuwamy metadane (w tym położenie), zanim je zapiszemy lub wyślemy.',
        'Nie wyświetlamy reklam, nie używamy narzędzi śledzących i nie sprzedajemy danych.',
      ],
    },
  ],
  sections: [
    {
      title: '1. Administrator danych',
      blocks: [
        p(
          'Administratorem Twoich danych osobowych jest [nazwa administratora], [adres] (dalej: „my”). Kontakt ' +
            'w sprawach danych osobowych: [adres e-mail kontaktowy]. [Jeśli zostanie wyznaczony inspektor ochrony ' +
            'danych – jego dane kontaktowe.]',
        ),
      ],
    },
    {
      title: '2. Lokalizacja',
      blocks: [
        p(
          'Za Twoją zgodą (uprawnienie „Lokalizacja” w telefonie) Aplikacja odczytuje pozycję GPS – tylko wtedy, gdy ' +
            'jest otwarta na ekranie. Nie śledzimy Cię w tle.',
        ),
        list(
          '**Gmina** – wykrywamy ją na telefonie, bez internetu, z granic gmin zapisanych w Aplikacji (Państwowy ' +
            'Rejestr Granic).',
          '**Mapa okolicy i odległość do lasu** – liczone na telefonie z pobranych kafli mapy (punkt 3).',
          '**Prognoza grzybowa** – liczona na telefonie z danych pogodowych; do serwisu pogody trafia tylko przybliżona ' +
            'okolica, nie Twoja pozycja (punkt 3).',
          '**Dystans i trasa wyprawy** – punkty GPS trzymamy wyłącznie w pamięci operacyjnej telefonu; znikają ' +
            'po zamknięciu lub ponownym uruchomieniu Aplikacji. Nie zapisujemy ich w pamięci telefonu ani nie wysyłamy ' +
            'na serwer.',
          '**Publikacja wyprawy** – wpis zawiera gminę, dystans, czas i znaleziska, a zamiast trasy tylko informację ' +
            '„trasa przybliżona” albo „trasa ukryta”. Mapa w podsumowaniu wyprawy pokazuje trasę uproszczoną i bez ' +
            'okolic startu i mety.',
        ),
        p(
          'Na serwer wysyłamy tylko gminę (wyprawy, znaleziska i gminę domową) oraz przebyty dystans. Zgodę ' +
            'na lokalizację możesz w każdej chwili cofnąć w ustawieniach telefonu – rozpoczęcie wyprawy wymaga jednak ' +
            'lokalizacji.',
        ),
      ],
    },
    {
      title: '3. Mapa okolicy i pogoda (OpenFreeMap, Open-Meteo)',
      blocks: [
        p(
          'Mapę okolicy Aplikacja rysuje z kafli mapy pobieranych z serwerów OpenFreeMap (dane © OpenStreetMap). ' +
            'Zapytanie zawiera tylko numery kafli – obszar o boku kilku kilometrów wokół Ciebie – a nie Twoje ' +
            'współrzędne. Jak przy każdym połączeniu z internetem, serwer kafli widzi adres IP urządzenia i podstawowe ' +
            'dane techniczne zapytania. [Do weryfikacji: rola dostawcy kafli (odrębny administrator czy podmiot ' +
            'przetwarzający) i jego polityka prywatności.]',
        ),
        p(
          'Kafle mapy zapisujemy na telefonie, żeby mapa działała w lesie bez zasięgu: oglądane okolice (do ok. 30 MB – ' +
            'najdawniej używane usuwamy same) i obszary, które sam pobierzesz na offline (okolica albo cała gmina). ' +
            'Przy obszarze offline zapisujemy jego nazwę i zasięg z dokładnością do kafla mapy (ok. 3 km) – nie Twoją ' +
            'pozycję. Nic z tego nie trafia na nasz serwer; usuniesz to w Ustawieniach → Mapy offline.',
        ),
        p(
          'Prognozę grzybową Aplikacja liczy na telefonie z danych pogodowych Open-Meteo.com (licencja CC BY 4.0). ' +
            'Zapytanie zawiera tylko współrzędne zaokrąglone do 0,1° – obszar ok. 11 × 7 km – a nie Twoją pozycję. ' +
            'Pogodę dla tego obszaru telefon pamięta do 3 godzin, żeby nie pytać ponownie. Serwer Open-Meteo widzi ' +
            'adres IP urządzenia i podstawowe dane techniczne zapytania. [Do weryfikacji: rola Open-Meteo i jego ' +
            'polityka prywatności; darmowe API jest tylko do użytku niekomercyjnego – przy płatnej aplikacji ' +
            'lub reklamach potrzebna subskrypcja.]',
        ),
      ],
    },
    {
      title: '4. Aparat i zdjęcia',
      blocks: [
        p(
          'Za Twoją zgodą (uprawnienie „Aparat”) Aplikacja używa aparatu do skanu grzyba i zdjęcia znaleziska, a jeśli ' +
            'chcesz – do zdjęcia profilowego. Zdjęcie profilowe możesz też wybrać z galerii: systemowy wybór zdjęć ' +
            'udostępnia Aplikacji tylko wskazane zdjęcie. Aplikacja nie nagrywa filmów ani dźwięku.',
        ),
        list(
          'Zdjęcia zmniejszamy i zapisujemy od nowa, co usuwa metadane EXIF – w tym współrzędne GPS, datę wykonania ' +
            'i model telefonu.',
          '**Rozpoznanie gatunku** – zdjęcie zrobione spustem skanu (już bez EXIF) wraz z bieżącym miesiącem ' +
            'i województwem wysyłamy przez nasz serwer do Anthropic (model AI Claude) wyłącznie po to, by rozpoznać ' +
            'grzyba. Nie wysyłamy gminy, współrzędnych, nicku ani innych danych Konta, a Aplikacja nie używa tego ' +
            'zdjęcia do żadnego innego celu. Na serwerze zapisujemy tylko dziennik wywołań (czas, status, zużycie – bez ' +
            'zdjęcia i wyniku) do limitu rozpoznań i kontroli kosztów. [Do weryfikacji prawnej: rola Anthropic jako ' +
            'podmiotu przetwarzającego, umowa powierzenia, okres przechowywania zapytań u dostawcy, transfer do USA.]',
          '**Zdjęcia znalezisk** przechowujemy na telefonie, a po synchronizacji także w prywatnym magazynie plików ' +
            'powiązanym z Twoim Kontem – dostęp do nich masz tylko Ty. Zdjęcie odrzucone przy rozpoznaniu („to nie ' +
            'grzyb”, niewyraźne ujęcie) od razu usuwamy z telefonu.',
          '**Okładka wpisu** (zdjęcie znaleziska dołączone do opublikowanej wyprawy) i **zdjęcie profilowe** są ' +
            'publiczne: widzą je inni Użytkownicy, a technicznie może je otworzyć każdy, kto zna ich losowy adres.',
        ),
      ],
    },
    {
      title: '5. Konto i profil',
      blocks: [
        p(
          'Przy pierwszym uruchomieniu tworzymy anonimowe Konto: losowy identyfikator i klucz sesji zapisany ' +
            'na telefonie. Nie prosimy o telefon ani hasło. Zapisujemy też, którą wersję regulaminu i Polityki ' +
            'prywatności zaakceptowałeś i kiedy, oraz kiedy skończyłeś pierwszą konfigurację Aplikacji.',
        ),
        list(
          '**Adres e-mail** (tylko jeśli zabezpieczysz Konto) – do logowania jednorazowym kodem, także na innym ' +
            'telefonie. Inni Użytkownicy go nie widzą; nie wysyłamy na niego reklam ani newslettera.',
          '**Nick** oraz **imię i nazwisko** (może to być pseudonim) – widoczne dla innych Użytkowników, np. jako autor ' +
            'wpisu; wyszukiwarka znajomych znajdzie Cię po nicku i po imieniu.',
          '**Gmina domowa** – do rankingu gmin; inni widzą ją w Twoim profilu.',
          '**Avatar** – motyw graficzny albo zdjęcie (punkt 4).',
          '**Opis „O mnie”** – zostaje na telefonie.',
        ),
      ],
    },
    {
      title: '6. Dane gry i społeczności',
      blocks: [
        p('Żeby gra działała, liczyła rankingi i pozwalała dzielić się wyprawami, na serwerze zapisujemy:'),
        list(
          'wyprawy: gmina, czas rozpoczęcia i zakończenia, dystans, punkty;',
          'znaleziska: gatunek, rzadkość, szacowane wymiary i waga, gmina, czas, wynik rozpoznania;',
          'postęp: XP, poziom, seria dni, atlas gatunków, odznaki, osiągnięcia, zadania, przyjęte wyzwania, ' +
            'obserwowane gminy;',
          'społeczność: wpisy, komentarze, reakcje „Darz grzyb!”, znajomi i zaproszenia, ukryte wpisy, zablokowani ' +
            'Użytkownicy i Twoje zgłoszenia.',
        ),
        p(
          'Inni Użytkownicy widzą Twój profil (nick, imię lub pseudonim, avatar, poziom, gminę domową, liczbę wypraw, ' +
            'grzybów i gatunków) oraz Twoje wpisy – dopiero 24 godziny po publikacji. Statystyki i rankingi gmin ' +
            'to zbiorcze wyliczenia ze znalezisk sprzed co najmniej 24 godzin; w rekordach gminy pokazujemy nick autora ' +
            'rekordowego okazu.',
        ),
      ],
    },
    {
      title: '7. Powiadomienia',
      blocks: [
        p(
          'Przypomnienia i powiadomienia (seria dni, wpis widoczny dla innych, reakcje i komentarze znajomych, ' +
            'podsumowanie tygodnia) planuje sam telefon – to powiadomienia lokalne. Nie wysyłamy powiadomień push ' +
            'z serwera i nie zbieramy tokenów push. O nowe reakcje i komentarze Aplikacja pyta serwer, gdy jest otwarta. ' +
            'Zgodę i rodzaje powiadomień zmienisz w Ustawieniach Aplikacji i telefonu.',
        ),
      ],
    },
    {
      title: '8. Dane na telefonie i dane techniczne',
      blocks: [
        list(
          'Na telefonie zapisujemy stan gry, ustawienia, zdjęcia, centrum powiadomień i kolejkę zdarzeń do wysłania. ' +
            '„Wyczyść dane” w Ustawieniach usuwa je z telefonu (nie usuwa Konta na serwerze), a „Usuń konto” – z ' +
            'telefonu i z serwera (punkt 12). Mapy offline i pamięć podręczna mapy (punkt 3) nie są danymi gry ani ' +
            'Konta – zostają po „Wyczyść dane” i „Usuń konto”; usuwasz je w Ustawieniach → Mapy offline.',
          'Serwer zapisuje dane techniczne połączeń (m.in. adres IP, czas i rodzaj zapytania) – żeby zapewnić ' +
            'bezpieczeństwo i usuwać błędy.',
          'Błędy Aplikacji trafiają obecnie tylko do dziennika systemowego telefonu. [Jeśli zostanie dodane narzędzie ' +
            'do raportowania błędów, np. Sentry – uzupełnić: zakres danych, dostawca, okres przechowywania.]',
          'Nie używamy reklam, analityki marketingowej ani narzędzi śledzących.',
        ),
      ],
    },
    {
      title: '9. Cele i podstawy prawne',
      blocks: [
        list(
          'świadczenie usługi zgodnie z regulaminem – Konto, gra, synchronizacja, funkcje społecznościowe ' +
            '(art. 6 ust. 1 lit. b RODO);',
          'bezpieczeństwo, zapobieganie nadużyciom i oszustwom w grze, moderacja treści, statystyki gmin oraz ustalanie, ' +
            'dochodzenie i obrona roszczeń – nasz prawnie uzasadniony interes (art. 6 ust. 1 lit. f RODO);',
          'obowiązki prawne, np. rozpatrywanie reklamacji i zgłoszeń nielegalnych treści (art. 6 ust. 1 lit. c RODO);',
          'dostęp do lokalizacji, aparatu, zdjęć i powiadomień – wyłącznie po udzieleniu uprawnienia w telefonie, które ' +
            'możesz w każdej chwili cofnąć. [Do weryfikacji: zgoda na dostęp do informacji w urządzeniu – ustawa ' +
            'Prawo komunikacji elektronicznej.]',
        ),
        p(
          'Nie podejmujemy wobec Ciebie decyzji opartych wyłącznie na zautomatyzowanym przetwarzaniu, które wywoływałyby ' +
            'skutki prawne (art. 22 RODO). Rozpoznanie gatunku i rankingi są elementami gry.',
        ),
      ],
    },
    {
      title: '10. Odbiorcy danych',
      blocks: [
        list(
          '**Supabase** – hosting bazy danych, kont i plików jako podmiot przetwarzający, na podstawie umowy powierzenia ' +
            '(DPA). Dane przechowujemy na serwerach w Unii Europejskiej: [region do wybrania, np. Frankfurt]. ' +
            '[Do weryfikacji: ewentualny dostęp z USA i podstawa transferu – EU-US Data Privacy Framework albo ' +
            'standardowe klauzule umowne.]',
          '**OpenFreeMap** – serwer kafli mapy (adres IP i numery kafli, punkt 3).',
          '**Open-Meteo** – serwis pogody do prognozy grzybowej (adres IP i współrzędne zaokrąglone do 0,1°, punkt 3).',
          '**Anthropic** – model AI Claude rozpoznający gatunek ze zdjęcia (zdjęcie, miesiąc i województwo, punkt 4) ' +
            'jako podmiot przetwarzający. [Do weryfikacji: umowa powierzenia (DPA), okres przechowywania zapytań ' +
            'u dostawcy, transfer do USA – EU-US Data Privacy Framework albo standardowe klauzule umowne.]',
          '**Dostawca poczty e-mail** – wysyła kody logowania na adres Konta zabezpieczonego e-mailem. [Do uzupełnienia: ' +
            'dostawca serwera poczty (SMTP) i podstawa przekazania.]',
          '**Inni Użytkownicy** – w zakresie opisanym w punktach 5 i 6.',
          '**Apple i Google** – sklepy z aplikacjami i systemy telefonów przetwarzają dane według własnych zasad ' +
            '(np. przy pobraniu Aplikacji); nie przekazujemy im danych z gry.',
          'Organy publiczne – tylko wtedy, gdy wymaga tego prawo.',
        ),
      ],
    },
    {
      title: '11. Jak długo przechowujemy dane',
      blocks: [
        list(
          'pozycja GPS i ślad wyprawy – tylko w pamięci telefonu, do zamknięcia Aplikacji;',
          'pogoda dla przybliżonej okolicy (obszar 0,1°) – w pamięci telefonu do 3 godzin;',
          'dziennik rozpoznań zdjęć na serwerze (czas, status, zużycie – bez zdjęcia i wyniku) – 7 dni;',
          'kafle mapy na telefonie – pamięć podręczna do ok. 30 MB (najdawniej używane usuwamy same), mapy offline – do ' +
            'usunięcia w Ustawieniach → Mapy offline albo odinstalowania Aplikacji;',
          'Konto, profil, dane gry i Treści – do usunięcia Konta; Konto nieaktywne przez [okres] możemy usunąć ' +
            '[do decyzji];',
          'zgłoszenia i decyzje moderacyjne – [okres] od rozpatrzenia;',
          'dane techniczne połączeń (logi serwera) – [okres];',
          'dane na telefonie – do użycia „Wyczyść dane” albo odinstalowania Aplikacji.',
        ),
        p(
          'Po usunięciu Konta w Aplikacji („Usuń konto”) od razu kasujemy z serwera Twoje dane gry, wpisy, komentarze, ' +
            'reakcje, znajomości, zdjęcia i samo Konto (także adres e-mail). Z kopii zapasowych dane znikają w ciągu ' +
            '[okres]. Zostać mogą zbiorcze statystyki gmin, z których nie da się Cię zidentyfikować.',
        ),
      ],
    },
    {
      title: '12. Twoje prawa',
      blocks: [
        p('Na zasadach z RODO masz prawo do:'),
        list(
          'dostępu do swoich danych i otrzymania ich kopii (art. 15);',
          'sprostowania danych (art. 16) – nick, imię i gminę domową poprawisz sam w Ustawieniach → Edytuj profil;',
          'usunięcia danych (art. 17);',
          'ograniczenia przetwarzania (art. 18);',
          'przenoszenia danych – eksportu w formacie do odczytu maszynowego (art. 20);',
          'sprzeciwu wobec przetwarzania opartego na naszym prawnie uzasadnionym interesie (art. 21);',
          'cofnięcia uprawnień (lokalizacja, aparat, zdjęcia, powiadomienia) w ustawieniach telefonu – w każdej chwili;',
          'wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa, uodo.gov.pl).',
        ),
        p(
          'Kopię swoich danych (plik JSON do odczytu maszynowego) pobierzesz sam w Ustawieniach → „Pobierz moje dane”, ' +
            'a Konto usuniesz w Ustawieniach → „Usuń konto”. W innych sprawach napisz na [adres e-mail kontaktowy] ' +
            'i podaj swój nick oraz identyfikator Konta (Ustawienia → Konto i logowanie) – pomogą nam potwierdzić, że ' +
            'Konto należy do Ciebie. Odpowiemy w ciągu miesiąca.',
        ),
      ],
    },
    {
      title: '13. Dzieci',
      blocks: [
        p(
          'Aplikacja jest przeznaczona dla osób, które ukończyły 16 lat. Osoby młodsze mogą z niej korzystać tylko ' +
            'za zgodą rodzica lub opiekuna prawnego. Jeśli dowiemy się, że przetwarzamy dane dziecka poniżej 16 lat ' +
            'bez takiej zgody, usuniemy je.',
        ),
      ],
    },
    {
      title: '14. Bezpieczeństwo',
      blocks: [
        p(
          'Połączenia z serwerem są szyfrowane (HTTPS). Dostęp do danych na serwerze ograniczają reguły bezpieczeństwa ' +
            'bazy danych: prywatne dane widzi tylko właściciel Konta, a publiczne statystyki są wyłącznie zbiorcze. ' +
            'Zbieramy tylko dane potrzebne do działania gry.',
        ),
      ],
    },
    {
      title: '15. Zmiany polityki',
      blocks: [
        p(
          'O istotnych zmianach polityki prywatności poinformujemy w Aplikacji. Aktualna wersja jest zawsze dostępna ' +
            'w Ustawieniach → Informacje prawne.',
        ),
        p('Polityka obowiązuje od [data wejścia w życie].'),
      ],
    },
  ],
};

export const LEGAL_DOCS: readonly LegalDoc[] = [REGULAMIN, POLITYKA_PRYWATNOSCI];

/**
 * Wersja dokumentów akceptowana w onboardingu (`accept_terms`, 1–32 znaki): data najnowszej zmiany regulaminu
 * albo polityki. Zmiana treści = nowa data w `updated` = nowa wersja (serwer zapisze kolejną akceptację).
 */
export const LEGAL_VERSION: string = LEGAL_DOCS.map((d) => d.updated).sort().at(-1)!;

/** `**pogrubienie**` → fragmenty tekstu. Niesparowane `**` zostaje zwykłym tekstem. */
export function splitBold(text: string): TextRun[] {
  const parts = text.split('**');
  if (parts.length % 2 === 0) return [{ text, bold: false }];
  return parts.map((t, i) => ({ text: t, bold: i % 2 === 1 })).filter((r) => r.text.length > 0);
}

/** „2026-10-07” → „7 października 2026”. */
export function fmtLegalDate(iso: string): string {
  const MONTHS = [
    'stycznia',
    'lutego',
    'marca',
    'kwietnia',
    'maja',
    'czerwca',
    'lipca',
    'sierpnia',
    'września',
    'października',
    'listopada',
    'grudnia',
  ];
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function blockToMarkdown(b: LegalBlock): string {
  if (b.kind === 'p') return b.text;
  if (b.kind === 'list') return b.items.map((x) => `- ${x}`).join('\n');
  const lines = [`**${b.title}**`];
  if (b.text) lines.push('', b.text);
  if (b.items) lines.push('', ...b.items.map((x) => `- ${x}`));
  return lines.map((l) => (l ? `> ${l}` : '>')).join('\n');
}

/** Dokument → Markdown (docs/legal/*.md). Te same teksty co na ekranie, `**` zostaje pogrubieniem. */
export function legalToMarkdown(doc: LegalDoc): string {
  const out = [
    `<!-- Plik generowany z src/data/legal.ts (npm run legal:md) – nie edytuj ręcznie. -->`,
    '',
    `# ${doc.fullTitle}`,
    '',
    `> **${LEGAL_DRAFT_NOTICE}**`,
    '',
    `Wersja robocza z ${fmtLegalDate(doc.updated)}.`,
  ];
  for (const b of doc.intro) out.push('', blockToMarkdown(b));
  for (const s of doc.sections) {
    out.push('', `## ${s.title}`);
    for (const b of s.blocks) out.push('', blockToMarkdown(b));
  }
  return out.join('\n') + '\n';
}
