/** Formatowanie po polsku: spacje tysięcy, przecinek dziesiętny, daty i czasy. */

export function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function fmtSigned(n: number): string {
  return `${n >= 0 ? '+' : '−'}${fmtInt(Math.abs(n))}`;
}

export function fmtKm(km: number): string {
  return `${km.toFixed(1).replace('.', ',')} km`;
}

export function fmtWeight(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(1).replace('.', ',')} kg`;
  return `${Math.round(g)} g`;
}

export function fmtTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** „3 h 12 min” */
export function fmtDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${m} min`;
}

/** „2 h 40” (kompaktowo w feedzie). */
export function fmtDurationShort(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

const DAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
const MONTHS = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];

export function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** „Sobota, 4 października · 07:12–10:24” */
export function fmtTripDate(start: Date, end: Date): string {
  return `${DAYS[start.getDay()]}, ${start.getDate()} ${MONTHS[start.getMonth()]} · ${fmtClock(start)}–${fmtClock(end)}`;
}

export function fmtDayMonth(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** „przed chwilą”, „5 h temu”, „wczoraj”, „2 dni temu” */
export function fmtAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'przed chwilą';
  if (min < 60) return `${min} min temu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h temu`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'wczoraj';
  return `${d} dni temu`;
}

/** Data `YYYY-MM-DD` (dzień lokalny) albo czas ISO → północ tego dnia w czasie lokalnym. */
function localDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Ile dni temu (dniami kalendarzowymi): „dziś”, „wczoraj”, „5 dni temu”, „3 tyg. temu”, „2 mies. temu”. */
export function fmtDaysAgo(value: string, now = Date.now()): string {
  const day = localDay(value);
  if (!day) return '';
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  // Zaokrąglenie wyrównuje zmianę czasu letniego (doba 23 / 25 h).
  const days = Math.max(0, Math.round((today.getTime() - day.getTime()) / 86400000));
  if (days === 0) return 'dziś';
  if (days === 1) return 'wczoraj';
  if (days < 14) return `${days} dni temu`;
  if (days < 60) return `${Math.floor(days / 7)} tyg. temu`;
  return `${Math.floor(days / 30)} mies. temu`;
}

/** Odmiana: 1 grzybiarz, 2–4 grzybiarzy… (uproszczona do potrzeb UI). */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  if (d >= 2 && d <= 4 && (t < 12 || t > 14)) return few;
  return many;
}

/** „1 grzybiarz”, „3 grzybiarze”, „5 grzybiarzy”. */
export function fmtMushroomers(n: number): string {
  return `${fmtInt(n)} ${plural(n, 'grzybiarz', 'grzybiarze', 'grzybiarzy')}`;
}

/** Odległość w metrach: „350 m”, „1,2 km”. */
export function fmtDistanceM(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Rozmiar pliku / danych (MB dziesiętne, jak w ustawieniach telefonu): „0,6 MB”, „12 MB”, „< 0,1 MB”. */
export function fmtMB(bytes: number): string {
  const mb = Math.max(0, bytes) / 1e6;
  if (mb === 0) return '0 MB';
  if (mb < 0.1) return '< 0,1 MB';
  if (mb < 10) return `${mb.toFixed(1).replace('.', ',')} MB`;
  return `${fmtInt(mb)} MB`;
}

/** „Gmina Supraśl” albo „Miasto Hajnówka” (gmina miejska). */
export function gminaTitle(g: { name: string; kind?: string } | undefined): string {
  if (!g) return '';
  return `${g.kind === 'miejska' ? 'Miasto' : 'Gmina'} ${g.name}`;
}

/** Miejsce gminy w podpisie wiersza rankingu: „powiat sokólski”, „miasto na prawach powiatu”, „miasto · powiat bielski”. */
export function placeLabel(g: { kind?: string; powiat?: string | null }): string {
  if (!g.powiat) return g.kind === 'miejska' ? 'miasto' : 'gmina';
  if (g.powiat[0] !== g.powiat[0].toLowerCase()) return 'miasto na prawach powiatu';
  return g.kind === 'miejska' ? `miasto · powiat ${g.powiat}` : `powiat ${g.powiat}`;
}

/**
 * „Puszcza Knyszyńska · podlaskie”, a bez kompleksu leśnego „powiat białostocki · podlaskie”.
 * Powiaty grodzkie mają w PRG nazwę miasta („Białystok”) → „miasto na prawach powiatu”.
 */
export function gminaSubtitle(g: { forest?: string; powiat?: string; voivodeship: string }): string {
  const cityCounty = !!g.powiat && g.powiat[0] !== g.powiat[0].toLowerCase();
  const place = g.forest ?? (g.powiat ? (cityCounty ? 'miasto na prawach powiatu' : `powiat ${g.powiat}`) : null);
  return place ? `${place} · ${g.voivodeship}` : g.voivodeship;
}
