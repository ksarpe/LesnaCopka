// @ts-nocheck – kod Deno (importy `npm:` i z rozszerzeniem `.ts`, globalny `Deno`); tsconfig aplikacji obejmuje
// **/*.ts, więc bez tego `npm run typecheck` zgłaszałby błędy w pliku, który nie należy do aplikacji. Typy sprawdza
// `deno check`. Czyste części (schemat, prompt, walidacja, normalizacja) są w ./contract.ts – testuje je jest.
/**
 * Edge Function `identify` – rozpoznanie grzyba ze zdjęcia przez model Claude (Anthropic API, wizja + structured
 * outputs). Zastępuje dawną symulację w aplikacji: zdjęcie ściany czy liścia daje „to nie grzyb”, a nie borowika.
 *
 * POST /functions/v1/identify z sesją gracza (JWT – także konto anonimowe; bez ważnego tokenu → 401)
 *   body:  { image: '<JPEG base64>', month?: 1–12, voivodeship?: 'podlaskie' }      (IdentifyRequestBody)
 *   200:   { verdict, reason, candidates[{speciesId, confidence}], visibleParts, count, capCm, heightCm, maturity }
 *   błąd:  { error: 'not_authenticated' | 'bad_request' | 'rate_limited' | 'not_configured' | 'model_unavailable'
 *                   | 'model_error' | 'internal', message?: '<po polsku>', retryAfter?: ISO }  (IdentifyErrorBody)
 *
 * Koszty: limit na gracza – 60 rozpoznań na 24 h i jedno naraz (RPC `identify_begin` / `identify_finish`, migracja
 * 20261014100000_identify.sql – mechanizm `check_rate_limit` z etapu 7). Prompt systemowy (instrukcje + katalog 120
 * gatunków) jest stały i trafia do cache promptu; zmienne są tylko zdjęcie i krótki kontekst (miesiąc, województwo).
 *
 * Zmienne: ANTHROPIC_API_KEY (wymagana – sekret), IDENTIFY_MODEL (domyślnie claude-opus-5-5). Tylko do testów
 * dewelopera: IDENTIFY_PROVIDER=gemini + GEMINI_API_KEY (+ GEMINI_MODEL, domyślnie gemini-3.8-flash) – ./gemini.ts,
 * nie do wydania (darmowy Gemini jest niedozwolony dla użytkowników z EOG i trenuje na zdjęciach). SUPABASE_URL
 * i SUPABASE_SERVICE_ROLE_KEY dostarcza platforma. Lokalnie: `npx supabase functions serve identify --env-file
 * supabase/functions/.env` (wzór: supabase/functions/identify/.env.example), w chmurze: `npx supabase secrets set
 * ANTHROPIC_API_KEY=…` i `npx supabase functions deploy identify`.
 *
 * Nigdy nie logujemy klucza API ani zdjęcia. Zdjęcie nie jest zapisywane przez tę funkcję (Storage – osobno, kolejką).
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
  normalizeIdent,
  parseRequestBody,
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
};

// Jedna próba ponowienia (429 / 529 / sieć) – całość mieści się w limicie aplikacji (~25 s).
const anthropic = PROVIDER === 'anthropic' && apiKey ? new Anthropic({ apiKey, maxRetries: 1, timeout: 12_000 }) : null;
const configured = PROVIDER === 'gemini' ? !!geminiKey : !!anthropic;

/** Rozpoznanie u wybranego dostawcy – ten sam wynik ({ status, result | error, meta }) dla obu. */
function classifyWith(image: string, text: string, signal: AbortSignal) {
  if (PROVIDER === 'gemini') {
    return classifyGemini({
      apiKey: geminiKey,
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      schema: IDENT_SCHEMA,
      image,
      text,
      signal,
      isKnown: (id) => KNOWN.has(id),
      refused: REFUSED,
    });
  }
  return classify(image, text, signal);
}

/** Rozmowa z modelem → { result | status } (bez rzucania – dziennik limitu dostaje wynik). */
async function classify(image: string, text: string, signal: AbortSignal) {
  try {
    const response = await anthropic.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
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
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
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
      console.error('[identify] odpowiedź ucięta (max_tokens)');
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
      console.error('[identify] odpowiedź modelu poza schematem');
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
    if (e instanceof Anthropic.APIConnectionError) {
      // Także limit czasu i przerwanie (aplikacja zamknęła połączenie).
      console.error('[identify] Anthropic: brak połączenia / limit czasu');
      return { status: 'failed', error: 'model_unavailable' };
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
  internal: 'Coś poszło nie tak – spróbuj ponownie.',
};
const ERROR_STATUS = { not_configured: 503, model_unavailable: 503, model_error: 502, internal: 500 };

Deno.serve(async (req) => {
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'bad_request', message: 'Nieprawidłowe żądanie' }, 400);
  }
  const parsed = parseRequestBody(raw);
  if (!parsed.ok) return json({ error: 'bad_request', message: parsed.message }, 400);

  if (!configured) {
    console.error(`[identify] brak klucza API (${PROVIDER === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'})`);
    return json({ error: 'not_configured', message: ERROR_COPY.not_configured }, 503);
  }

  // Limit kosztów: 60 / 24 h i jedno rozpoznanie naraz (P0001 rate_limited – opis po polsku w details).
  const begin = await admin.rpc('identify_begin', { p_user: uid });
  if (begin.error) {
    if (begin.error.code === 'P0001' && begin.error.message === 'rate_limited') {
      const retryAfter = /^retry_after=(.+)$/.exec(begin.error.hint ?? '')?.[1] ?? null;
      return json({ error: 'rate_limited', message: begin.error.details, retryAfter }, 429);
    }
    console.error('[identify] identify_begin', begin.error.code, begin.error.message);
    return json({ error: 'internal', message: ERROR_COPY.internal }, 500);
  }
  const callId = begin.data;

  const out = await classifyWith(parsed.body.image, buildRequestText(parsed.body), req.signal);

  // Dziennik limitu (best effort – błąd zapisu nie psuje odpowiedzi).
  const fin = await admin.rpc('identify_finish', {
    p_id: callId,
    p_user: uid,
    p_status: out.status,
    p_model: out.meta?.model ?? MODEL,
    p_input_tokens: out.meta?.inputTokens ?? null,
    p_output_tokens: out.meta?.outputTokens ?? null,
    p_cache_read_tokens: out.meta?.cacheReadTokens ?? null,
    p_cache_write_tokens: out.meta?.cacheWriteTokens ?? null,
  });
  if (fin.error) console.error('[identify] identify_finish', fin.error.code, fin.error.message);

  if (out.status === 'failed') return json({ error: out.error, message: ERROR_COPY[out.error] }, ERROR_STATUS[out.error]);
  return json(out.result);
});
