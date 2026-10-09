// @ts-nocheck – kod Deno (importy `npm:` i z rozszerzeniem `.ts`, globalny `Deno`); tsconfig aplikacji obejmuje
// **/*.ts, więc bez tego `npm run typecheck` zgłaszałby błędy w pliku, który nie należy do aplikacji. Typy sprawdza
// `deno check`. Czyste części (schemat, prompt, walidacja, normalizacja) są w ./contract.ts – testuje je jest.
/**
 * Edge Function `identify` – rozpoznanie grzyba ze zdjęcia przez model Claude (Anthropic API, wizja + structured
 * outputs) i PODPISANE ROZPOZNANIE: wynik zapisuje serwer (tabela recognitions), a submit_find bierze z niego gatunek,
 * wymiary, gminę, czas i zdjęcie – telefon przekazuje tylko id (docs/backend.md → „Podpisane rozpoznanie”).
 *
 * POST /functions/v1/identify z sesją gracza (JWT – także konto anonimowe; bez ważnego tokenu → 401)
 *   body:  { image: '<JPEG base64>', views?: [{ image, view: 'side'|'top'|'low' }] (≤ 3, skan 3D),
 *            month?: 1–12, voivodeship?: 'podlaskie', lat?, lon?, accuracyM? }           (IdentifyRequestBody)
 *   200:   { verdict, reason, candidates[{speciesId, confidence}], visibleParts, count, capCm, heightCm, maturity,
 *            scaleReference, reproduction, recognitionId, sizeMeasured, expiresAt }      (IdentifyFunctionResponse)
 *   błąd:  { error: 'not_authenticated' | 'bad_request' | 'rate_limited' | 'image_reused' (409) | 'service_busy' (503)
 *                   | 'not_configured' | 'model_unavailable' | 'model_error' | 'storage_error' | 'internal',
 *            message?: '<po polsku>', retryAfter?: ISO }                                  (IdentifyErrorBody)
 *
 * Przebieg (migracja 20261015100000_podpisane_rozpoznanie.sql):
 *  1. SHA-256 zdjęcia głównego i ujęć → `recognition_begin` (service_role): ten sam obraz u innego gracza albo już
 *     zużyty → 409 image_reused BEZ wołania modelu; ten sam gracz i to samo zdjęcie z ważnym / odrzuconym wynikiem
 *     („Spróbuj ponownie” po błędzie sieci) → zapisana odpowiedź bez modelu; limity; gmina z pozycji (gmina_at).
 *  2. Zdjęcie główne → Storage `scan-photos/{uid}/rec/{id}.jpg` (klucz serwisowy; klient nie może tam pisać) – zanim
 *     zapłacimy za model, więc zdjęcie znaleziska to zawsze dokładnie to, które widział model.
 *  3. Model → `recognition_finish` (wynik sprawdzony jeszcze raz w SQL, status issued / rejected, dziennik kosztów) →
 *     odpowiedź z rekordu. Odrzucone (nie grzyb, reprodukcja…) i błędy – plik znika ze Storage.
 *     Model ma własny limit czasu (20 s, nie `req.signal`): zerwane połączenie aplikacji nie marnuje zapłaconej odpowiedzi,
 *     a „Spróbuj ponownie” dostaje ją z rekordu. Aplikacja rozłączona jeszcze przed modelem → bez modelu i bez kosztu.
 *  4. W tle po każdym wywołaniu (EdgeRuntime.waitUntil): pliki porzuconych rozpoznań z `recognition_begin`
 *     (`stalePaths`) i `recognition_cleanup` – przeterminowane, porzucone i stare odrzucone rozpoznania, ich pliki.
 *  Treść żądania > MAX_BODY_BYTES → 413; każdy nieprzewidziany wyjątek → JSON `internal` (z CORS).
 *
 * Koszty: limit na gracza – 60 rozpoznań na 24 h (konto młodsze niż doba: 20), jedno naraz i globalny dzienny limit
 * gry (anti_cheat_params). Wywołanie, które dotarło do modelu, liczy się także przy błędzie i limicie czasu
 * (identify_calls.charged). Prompt systemowy (instrukcje + katalog gatunków) jest stały i trafia do cache promptu;
 * zmienne są tylko zdjęcia i krótki kontekst (miesiąc, województwo). Współrzędne NIE idą do modelu i nie są zapisywane
 * – serwer zapisuje tylko gminę.
 *
 * Zmienne: ANTHROPIC_API_KEY (wymagana – sekret), IDENTIFY_MODEL (domyślnie claude-opus-5-5). Tylko do testów
 * dewelopera: IDENTIFY_PROVIDER=gemini + GEMINI_API_KEY (+ GEMINI_MODEL, domyślnie gemini-3.8-flash) – ./gemini.ts,
 * nie do wydania (darmowy Gemini jest niedozwolony dla użytkowników z EOG i trenuje na zdjęciach). SUPABASE_URL
 * i SUPABASE_SERVICE_ROLE_KEY dostarcza platforma. Lokalnie: `npx supabase functions serve identify --env-file
 * supabase/functions/.env` (wzór: supabase/functions/identify/.env.example), w chmurze: `npx supabase secrets set
 * ANTHROPIC_API_KEY=…` i `npx supabase functions deploy identify`.
 *
 * Nigdy nie logujemy klucza API, zdjęcia ani pozycji.
 */
// eslint-disable-next-line import/no-unresolved -- specyfikator Deno (npm:), nie moduł z node_modules
import Anthropic from 'npm:@anthropic-ai/sdk';
// eslint-disable-next-line import/no-unresolved -- specyfikator Deno (npm:), nie moduł z node_modules
import { createClient } from 'npm:@supabase/supabase-js@2';

import { IDENT_CATALOG } from './catalog.ts';
import {
  buildIdentSchema,
  buildRequestText,
  buildSystemPrompt,
  MAX_BODY_BYTES,
  normalizeIdent,
  parseRequestBody,
  requestImages,
} from './contract.ts';
import { classifyGemini } from './gemini.ts';

const apiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim() || null;
const geminiKey = Deno.env.get('GEMINI_API_KEY')?.trim() || null;
/**
 * Dostawca: 'anthropic' (Claude – domyślny, do wydania) albo 'gemini' (tylko testy dewelopera – ./gemini.ts).
 * Bez IDENTIFY_PROVIDER: Claude, gdy jest jego klucz; inaczej Gemini, gdy jest tylko GEMINI_API_KEY.
 */
const PROVIDER =
  (Deno.env.get('IDENTIFY_PROVIDER')?.trim().toLowerCase() || (!apiKey && geminiKey ? 'gemini' : 'anthropic')) ===
  'gemini'
    ? 'gemini'
    : 'anthropic';

const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const MODEL =
  PROVIDER === 'gemini'
    ? Deno.env.get('GEMINI_MODEL')?.trim() || DEFAULT_GEMINI_MODEL
    : Deno.env.get('IDENTIFY_MODEL')?.trim() || DEFAULT_MODEL;
/** Haiku nie ma serwerowego „fallbacks” – tam parametr pomijamy. */
const SERVER_FALLBACK = !MODEL.startsWith('claude-haiku');
if (PROVIDER === 'gemini') console.warn(`[identify] dostawca testowy: Gemini (${MODEL}) – nie do wydania`);

/** Koszyk zdjęć znalezisk (prywatny) – zdjęcia rozpoznań w `{uid}/rec/`. */
const PHOTO_BUCKET = 'scan-photos';
/**
 * Własny limit czasu rozmowy z modelem (z ponowieniem). NIE `req.signal`: zerwane połączenie aplikacji nie przerywa
 * modelu w połowie (i tak zapłacone) – wynik trafia do rekordu, a „Spróbuj ponownie” dostaje go bez kosztu.
 */
const MODEL_DEADLINE_MS = 20_000;

const SPECIES_IDS = IDENT_CATALOG.map((s) => s.id);
const KNOWN = new Set(SPECIES_IDS);
// Stałe dla całego życia instancji – ten sam prompt i schemat = trafienia w cache promptu.
const SYSTEM_PROMPT = buildSystemPrompt(IDENT_CATALOG);
const IDENT_SCHEMA = buildIdentSchema(SPECIES_IDS);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Odpowiedź, gdy model odmówi (stop_reason „refusal”) – dla gracza to po prostu ujęcie do powtórzenia. */
const REFUSED = {
  verdict: 'unclear',
  reason: 'Nie mogę przeanalizować tego zdjęcia – zrób nowe ujęcie samego grzyba.',
  candidates: [],
  visibleParts: [],
  count: 0,
  capCm: null,
  heightCm: null,
  maturity: 'unknown',
  scaleReference: 'none',
  reproduction: false,
};

// Jedna próba ponowienia (429 / 529 / sieć), ~9 s na próbę – całość w MODEL_DEADLINE_MS i w limicie aplikacji (~25 s).
const anthropic = PROVIDER === 'anthropic' && apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 9_000 }) : null;
const configured = PROVIDER === 'gemini' ? !!geminiKey : !!anthropic;

/**
 * Rozpoznanie u wybranego dostawcy – ten sam wynik ({ status, result | error, meta }) dla obu. `images` – zdjęcie
 * główne i ujęcia skanu 3D z podpisami (requestImages w ./contract.ts).
 */
function classifyWith(images: { image: string; label: string | null }[], text: string, signal: AbortSignal) {
  if (PROVIDER === 'gemini') {
    return classifyGemini({
      apiKey: geminiKey,
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      schema: IDENT_SCHEMA,
      images,
      text,
      signal,
      isKnown: (id) => KNOWN.has(id),
      refused: REFUSED,
    });
  }
  return classify(images, text, signal);
}

/**
 * Rozmowa z modelem → { status, result | error, meta?, charged? } (bez rzucania – dziennik limitu dostaje wynik).
 * `charged` – żądanie mogło zostać przetworzone (przerwanie, zerwane połączenie, limit czasu): liczy się do limitu.
 */
async function classify(images: { image: string; label: string | null }[], text: string, signal: AbortSignal) {
  try {
    const response = await anthropic.beta.messages.create(
      {
        model: MODEL,
        // Opus 5.5 myśli w ramach max_tokens – zapas na myślenie przy niskim wysiłku.
        max_tokens: 4096,
        ...(SERVER_FALLBACK ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        output_config: {
          // Klasyfikacja – niski wysiłek (domyślny na Opus 5.5 to „medium”, więc ustawiamy jawnie).
          effort: 'low',
          format: { type: 'json_schema', schema: IDENT_SCHEMA },
        },
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [
          {
            role: 'user',
            // Każde ujęcie poprzedza podpis („Ujęcie 2 – z góry:”); jedno zdjęcie – bez podpisu.
            content: [
              ...images.flatMap(({ image, label }) => [
                ...(label ? [{ type: 'text', text: label }] : []),
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
              ]),
              { type: 'text', text },
            ],
          },
        ],
      },
      { signal },
    );
    const usage = response.usage ?? {};
    const meta = {
      model: response.model ?? MODEL,
      inputTokens: usage.input_tokens ?? null,
      outputTokens: usage.output_tokens ?? null,
      cacheReadTokens: usage.cache_read_input_tokens ?? null,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
    };
    if (response.stop_reason === 'refusal') {
      console.warn('[identify] odmowa modelu', response.stop_details?.category ?? null);
      return { status: 'refused', result: REFUSED, meta };
    }
    if (response.stop_reason === 'max_tokens') {
      console.error('[identify] odpowiedź ucięta', response.stop_reason, meta.outputTokens);
      return { status: 'failed', error: 'model_error', meta };
    }
    const block = response.content.find((b) => b.type === 'text');
    let parsed: unknown = null;
    try {
      parsed = block ? JSON.parse(block.text) : null;
    } catch {
      parsed = null;
    }
    const result = normalizeIdent(parsed, (id) => KNOWN.has(id));
    if (!result) {
      console.error('[identify] odpowiedź modelu poza schematem', response.stop_reason, meta.outputTokens);
      return { status: 'failed', error: 'model_error', meta };
    }
    return { status: 'ok', result, meta };
  } catch (e) {
    // Typowane klasy błędów SDK – bez dopasowywania treści komunikatów; nic z żądania (zdjęcia) nie trafia do logu.
    if (e instanceof Anthropic.RateLimitError) {
      console.error('[identify] Anthropic: limit zapytań (429)');
      return { status: 'failed', error: 'model_unavailable' };
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      console.error('[identify] Anthropic: nieprawidłowy klucz API albo brak uprawnień', e.status);
      return { status: 'failed', error: 'not_configured' };
    }
    if (e instanceof Anthropic.BadRequestError) {
      console.error('[identify] Anthropic: odrzucone żądanie (400)', e.message);
      return { status: 'failed', error: 'model_error' };
    }
    if (signal.aborted || e instanceof Anthropic.APIUserAbortError) {
      // Własny limit czasu (MODEL_DEADLINE_MS) – model mógł już pracować, więc wywołanie liczy się do limitu.
      console.warn('[identify] limit czasu rozmowy z modelem');
      return { status: 'failed', error: 'model_unavailable', charged: true };
    }
    if (e instanceof Anthropic.APIConnectionError) {
      // Także limit czasu – żądanie mogło dojść do modelu.
      console.error('[identify] Anthropic: brak połączenia / limit czasu');
      return { status: 'failed', error: 'model_unavailable', charged: true };
    }
    if (e instanceof Anthropic.APIError) {
      console.error('[identify] Anthropic: błąd API', e.status);
      return { status: 'failed', error: 'model_unavailable' };
    }
    console.error('[identify] nieoczekiwany błąd', e instanceof Error ? e.name : typeof e);
    return { status: 'failed', error: 'internal' };
  }
}

const ERROR_COPY = {
  not_configured: 'Rozpoznawanie jest chwilowo niedostępne (konfiguracja serwera).',
  model_unavailable: 'Serwer rozpoznawania jest teraz przeciążony – spróbuj za chwilę.',
  model_error: 'Nie udało się przeanalizować zdjęcia – spróbuj ponownie.',
  storage_error: 'Nie udało się zapisać zdjęcia na serwerze – spróbuj ponownie.',
  internal: 'Coś poszło nie tak – spróbuj ponownie.',
};
const ERROR_STATUS = { not_configured: 503, model_unavailable: 503, model_error: 502, storage_error: 503, internal: 500 };

/** Odmowy recognition_begin (P0001 + opis po polsku w details) → status HTTP. */
const BEGIN_ERRORS = { rate_limited: 429, image_reused: 409, service_busy: 503 };

/** JPEG z base64 (po parseRequestBody – poprawny alfabet). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** SHA-256 pliku (hex, małe litery) – skrót zdjęcia do globalnej unikalności (recognition_images). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Usunięcie plików rozpoznań ze Storage (bez rzucania; błąd do logu). */
async function removePhotos(admin, paths: unknown, what: string) {
  const list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : [];
  if (!list.length) return;
  try {
    const rm = await admin.storage.from(PHOTO_BUCKET).remove(list);
    if (rm.error) console.error(`[identify] ${what}: usuwanie plików`, rm.error.message);
  } catch (e) {
    console.error(`[identify] ${what}: usuwanie plików`, e instanceof Error ? e.name : typeof e);
  }
}

/**
 * Sprzątanie w tle po każdym wywołaniu: przeterminowane / porzucone / stare odrzucone rozpoznania (SQL) i ich pliki,
 * a także pliki porzuconych rozpoznań usuniętych w recognition_begin (`stalePaths`). Bez rzucania.
 */
async function cleanup(admin, stalePaths: unknown) {
  await removePhotos(admin, stalePaths, 'porzucone rozpoznania');
  try {
    const { data, error } = await admin.rpc('recognition_cleanup', { p_limit: 50 });
    if (error) return console.error('[identify] recognition_cleanup', error.code, error.message);
    await removePhotos(admin, data?.paths, 'recognition_cleanup');
  } catch (e) {
    console.error('[identify] sprzątanie', e instanceof Error ? e.name : typeof e);
  }
}

/** Zadanie po odpowiedzi (Supabase Edge Runtime); poza nim – zwykła obietnica bez czekania. */
function background(p: Promise<unknown>) {
  const rt = globalThis.EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
  else p.catch(() => {});
}

// Każdy nieprzewidziany wyjątek → JSON `internal` z nagłówkami CORS (aplikacja dostaje czytelny błąd, nie tekst 500).
Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error('[identify] nieoczekiwany wyjątek', e instanceof Error ? e.name : typeof e);
    return json({ error: 'internal', message: ERROR_COPY.internal }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Tylko zalogowany gracz (sesja z JWT – także konto anonimowe). verify_jwt w config.toml sprawdza podpis
  // na bramce; tu dodatkowo ustalamy, kto woła (id wyłącznie z tokenu, nigdy z treści żądania).
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'not_authenticated' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !auth.user) return json({ error: 'not_authenticated' }, 401);
  const uid = auth.user.id;

  // Rozmiar przed parsowaniem: nagłówek (gdy jest) i faktyczna treść – 4 zdjęcia w base64 to najwyżej ~4 MB.
  const declared = Number(req.headers.get('Content-Length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: 'bad_request', message: 'Zdjęcia są za duże' }, 413);
  }
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: 'bad_request', message: 'Zdjęcia są za duże' }, 413);
    raw = JSON.parse(text);
  } catch {
    return json({ error: 'bad_request', message: 'Nieprawidłowe żądanie' }, 400);
  }
  const parsed = parseRequestBody(raw);
  if (!parsed.ok) return json({ error: 'bad_request', message: parsed.message }, 400);

  if (!configured) {
    console.error(`[identify] brak klucza API (${PROVIDER === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'})`);
    return json({ error: 'not_configured', message: ERROR_COPY.not_configured }, 503);
  }

  const body = parsed.body;

  // 1. Skróty zdjęć (przed modelem) → recognition_begin: unikalność obrazu, ponowienie z zapisu, limity, gmina.
  const bytes = [body.image, ...(body.views ?? []).map((v) => v.image)].map(base64ToBytes);
  const hashes = await Promise.all(bytes.map(sha256Hex));
  const begin = await admin.rpc('recognition_begin', {
    p_user: uid,
    p_hashes: hashes,
    p_lat: body.lat ?? null,
    p_lon: body.lon ?? null,
    p_accuracy_m: body.accuracyM ?? null,
  });
  if (begin.error) {
    const status = begin.error.code === 'P0001' ? BEGIN_ERRORS[begin.error.message] : undefined;
    if (status) {
      const retryAfter = /^retry_after=(.+)$/.exec(begin.error.hint ?? '')?.[1] ?? null;
      return json({ error: begin.error.message, message: begin.error.details, retryAfter }, status);
    }
    console.error('[identify] recognition_begin', begin.error.code, begin.error.message);
    return json({ error: 'internal', message: ERROR_COPY.internal }, 500);
  }
  // Sprzątanie zawsze w tle (po odpowiedzi): porzucone rozpoznania i ich pliki nie blokują graczy.
  background(cleanup(admin, begin.data?.stalePaths));
  if (begin.data?.cached) return json(begin.data.cached);
  const { callId, recognitionId, photoPath } = begin.data;

  const finish = (status, extra = {}) =>
    admin.rpc('recognition_finish', {
      p_call_id: callId,
      p_user: uid,
      p_recognition_id: recognitionId,
      p_status: status,
      p_charged: extra.charged ?? null,
      p_result: extra.result ?? null,
      p_photo_path: extra.result ? photoPath : null,
      p_model: extra.meta?.model ?? MODEL,
      p_input_tokens: extra.meta?.inputTokens ?? null,
      p_output_tokens: extra.meta?.outputTokens ?? null,
      p_cache_read_tokens: extra.meta?.cacheReadTokens ?? null,
      p_cache_write_tokens: extra.meta?.cacheWriteTokens ?? null,
    });
  const dropPhoto = () => removePhotos(admin, [photoPath], 'zdjęcie odrzuconego rozpoznania');

  // 2. Zdjęcie główne do Storage – zanim zapłacimy za model.
  const up = await admin.storage.from(PHOTO_BUCKET).upload(photoPath, bytes[0], { contentType: 'image/jpeg', upsert: true });
  if (up.error) {
    console.error('[identify] zapis zdjęcia', up.error.message);
    const fin = await finish('failed', { charged: false });
    if (fin.error) console.error('[identify] recognition_finish', fin.error.code, fin.error.message);
    return json({ error: 'storage_error', message: ERROR_COPY.storage_error }, ERROR_STATUS.storage_error);
  }

  // Aplikacja zamknęła już połączenie (np. „Anuluj”) – bez modelu i bez kosztu; rozpoznanie znika, obraz wolny.
  if (req.signal.aborted) {
    const fin = await finish('failed', { charged: false });
    if (fin.error) console.error('[identify] recognition_finish', fin.error.code, fin.error.message);
    await dropPhoto();
    return json({ error: 'internal', message: ERROR_COPY.internal }, 499);
  }

  // 3. Model (własny limit czasu, nie req.signal) → wynik w rekordzie (SQL sprawdza go jeszcze raz) → odpowiedź z rekordu.
  const out = await classifyWith(requestImages(body), buildRequestText(body), AbortSignal.timeout(MODEL_DEADLINE_MS));
  const charged = out.status !== 'failed' || out.charged === true || !!out.meta;
  const fin = await finish(out.status, { charged, result: out.status === 'failed' ? null : out.result, meta: out.meta });
  if (fin.error) {
    console.error('[identify] recognition_finish', fin.error.code, fin.error.message);
    await dropPhoto();
    return json({ error: 'internal', message: ERROR_COPY.internal }, 500);
  }
  if (out.status === 'failed' || !fin.data) {
    await dropPhoto();
    const error = out.status === 'failed' ? out.error : 'internal';
    return json({ error, message: ERROR_COPY[error] }, ERROR_STATUS[error]);
  }
  // Odrzucone (nie grzyb, niewyraźne, reprodukcja, pewność < 60%…) – zdjęcie nie jest potrzebne.
  if (!fin.data.recognitionId) await dropPhoto();
  return json(fin.data);
}
