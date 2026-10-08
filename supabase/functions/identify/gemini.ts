// @ts-nocheck – kod Deno (globalny `fetch` z `AbortSignal.any`, import z rozszerzeniem `.ts`); typy sprawdza `deno check`.
/**
 * Dostawca TESTOWY: Google Gemini (REST `models.generateContent`) – do testów dewelopera na własnym kluczu, np. darmowym
 * z Google AI Studio. Wybór: IDENTIFY_PROVIDER=gemini (albo sam GEMINI_API_KEY bez ANTHROPIC_API_KEY) – index.ts.
 *
 * NIE do wydania: warunki Gemini API pozwalają aplikacjom dla użytkowników z EOG / Szwajcarii / UK korzystać tylko
 * z płatnego dostępu (projekt Cloud z płatnościami), a w darmowym Google używa przesłanych zdjęć do ulepszania usług
 * (także ręczny przegląd). Polityka prywatności aplikacji wymienia tylko Anthropic.
 *
 * Ten sam prompt systemowy, schemat i normalizacja co dla Claude (./contract.ts) – różni się tylko wywołanie.
 * Schemat idzie jako `responseJsonSchema`; gdy API go odrzuci (400), ponawiamy raz w samym trybie JSON
 * (`responseMimeType`) – i tak waliduje normalizeIdent.
 */
import { normalizeIdent } from './contract.ts';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Odpowiedź z modelem Gemini trwa zwykle kilka sekund; całość mieści się w limicie aplikacji (~25 s). */
const TIMEOUT_MS = 20_000;
/** Powody zakończenia = blokada filtrów Google (dla gracza – ujęcie do powtórzenia, jak odmowa Claude). */
const BLOCKED = new Set([
  'SAFETY',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'RECITATION',
  'IMAGE_RECITATION',
]);

/**
 * Rozpoznanie przez Gemini → ten sam kształt co classify() w index.ts:
 * { status: 'ok' | 'refused', result, meta } albo { status: 'failed', error, meta? }.
 */
export async function classifyGemini(opts) {
  const { apiKey, model, systemPrompt, schema, image, text, signal, isKnown, refused } = opts;
  const body = (withSchema) => ({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      ...(withSchema ? { responseJsonSchema: schema } : {}),
    },
  });

  const call = (withSchema) =>
    fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body(withSchema)),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });

  let res;
  try {
    res = await call(true);
    if (res.status === 400) {
      // Starszy model / API bez `responseJsonSchema` – drugi raz w samym trybie JSON (bez treści błędu w logu).
      console.warn('[identify] Gemini: 400 ze schematem – ponawiam w trybie JSON');
      res = await call(false);
    }
  } catch (e) {
    // Limit czasu, przerwanie (aplikacja zamknęła połączenie) albo brak sieci. Nic z żądania nie trafia do logu.
    console.error('[identify] Gemini: brak połączenia / limit czasu', e instanceof Error ? e.name : typeof e);
    return { status: 'failed', error: 'model_unavailable' };
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      console.error('[identify] Gemini: nieprawidłowy klucz API albo brak uprawnień', res.status);
      return { status: 'failed', error: 'not_configured' };
    }
    if (res.status === 400) {
      console.error('[identify] Gemini: odrzucone żądanie (400)');
      return { status: 'failed', error: 'model_error' };
    }
    // 429 (darmowy limit projektu), 5xx – przeciążenie.
    console.error('[identify] Gemini: błąd API', res.status);
    return { status: 'failed', error: 'model_unavailable' };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.error('[identify] Gemini: odpowiedź nie jest JSON-em');
    return { status: 'failed', error: 'model_error' };
  }

  const usage = data?.usageMetadata ?? {};
  const meta = {
    model: data?.modelVersion ?? model,
    inputTokens: usage.promptTokenCount ?? null,
    // Myślenie liczy się jak wyjście (cennik Gemini).
    outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) || null,
    cacheReadTokens: usage.cachedContentTokenCount ?? null,
    cacheWriteTokens: null,
  };

  const candidate = data?.candidates?.[0];
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason || BLOCKED.has(candidate?.finishReason)) {
    console.warn('[identify] Gemini: blokada filtrów', blockReason ?? candidate?.finishReason);
    return { status: 'refused', result: refused, meta };
  }
  if (candidate?.finishReason === 'MAX_TOKENS') {
    console.error('[identify] Gemini: odpowiedź ucięta (MAX_TOKENS)');
    return { status: 'failed', error: 'model_error', meta };
  }

  // Części „thought” (podsumowania myślenia) pomijamy – liczy się sam tekst odpowiedzi.
  const out = (candidate?.content?.parts ?? [])
    .filter((p) => typeof p?.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  let parsed = null;
  try {
    parsed = out ? JSON.parse(stripFence(out)) : null;
  } catch {
    parsed = null;
  }
  const result = normalizeIdent(parsed, isKnown);
  if (!result) {
    console.error('[identify] Gemini: odpowiedź poza schematem');
    return { status: 'failed', error: 'model_error', meta };
  }
  return { status: 'ok', result, meta };
}

/** Tryb JSON bez schematu czasem owija odpowiedź w ```json … ``` – zdejmujemy to. */
function stripFence(s) {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(s);
  return m ? m[1] : s;
}
