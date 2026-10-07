// @ts-nocheck – kod Deno (importy `npm:`, globalny `Deno`); tsconfig aplikacji obejmuje **/*.ts, więc bez tego
// `npm run typecheck` zgłaszałby błędy w pliku, który nie należy do aplikacji. Typy sprawdza `deno check`.
/**
 * Edge Function `delete-account` – usunięcie konta gracza (RODO art. 17) z uprawnieniami service role.
 * NIEWDROŻONA – na później, do chmury. Lokalnie `npx supabase start` serwuje ją sama (edge runtime):
 * POST http://127.0.0.1:54321/functions/v1/delete-account z sesją gracza.
 *
 * Po co, skoro jest RPC `delete_my_account()`?
 *  · Lokalnie (Docker) rola `postgres` – właściciel funkcji SECURITY DEFINER – może usunąć wiersz `auth.users`,
 *    więc `delete_my_account()` załatwia wszystko sama (`authUserDeleted: true`).
 *  · W chmurze Supabase zaleca usuwanie użytkowników przez Admin API (`auth.admin.deleteUser`), a uprawnienia roli
 *    `postgres` w schemacie `auth` mogą się zmienić. Gdy SQL nie może usunąć `auth.users`, `delete_my_account()`
 *    kasuje dane, anonimizuje profil i zwraca `{ authUserDeleted: false, next: 'edge_function:delete-account' }` –
 *    wtedy aplikacja woła tę funkcję. Można ją też wołać od razu zamiast RPC (robi pliki + konto w jednym kroku).
 *
 * Co robi (tylko dla właściciela sesji – id z JWT, nigdy z treści żądania):
 *  1. kasuje WSZYSTKIE pliki gracza w koszykach scan-photos, post-media, avatars (cały folder `{uid}/`, także pliki
 *     osierocone – bez odwołania w bazie);
 *  2. `auth.admin.deleteUser(uid)` → kaskada: auth.users → profiles → wszystkie tabele gracza (ten sam efekt co
 *     `delete_my_account()`; ON DELETE CASCADE w migracjach), sesje i refresh tokeny przestają działać.
 *
 * Aplikacja (supabase-js): `await supabase.functions.invoke('delete-account', { method: 'POST' })`, potem
 * `supabase.auth.signOut({ scope: 'local' })` i wyczyszczenie stanu lokalnego.
 *
 * Wdrożenie (później): `npx supabase functions deploy delete-account` – zmienne SUPABASE_URL i
 * SUPABASE_SERVICE_ROLE_KEY dostarcza platforma; verify_jwt = true (domyślne – patrz config.toml).
 */
// eslint-disable-next-line import/no-unresolved -- specyfikator Deno (npm:), nie moduł z node_modules
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const BUCKETS = ['scan-photos', 'post-media', 'avatars'] as const;
const PAGE = 1000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Wszystkie pliki pod `prefix` (rekurencyjnie – Storage list() zwraca foldery jako wpisy z id = null). */
async function listAll(client: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`${bucket}: ${error.message}`);
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      if (item.id === null) out.push(...(await listAll(client, bucket, path)));
      else out.push(path);
    }
    if (!data || data.length < PAGE) return out;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'not_authenticated' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Kto woła – wyłącznie z ważnej sesji (konto już usunięte → błąd, nic do zrobienia).
  const { data: auth, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !auth.user) return json({ error: 'not_authenticated', message: authError?.message }, 401);
  const uid = auth.user.id;

  // 1. Pliki (najpierw – po usunięciu konta nikt już nie wskaże, które są jego).
  const removedFiles: Record<string, number> = {};
  try {
    for (const bucket of BUCKETS) {
      const paths = await listAll(admin, bucket, uid);
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) throw new Error(`${bucket}: ${error.message}`);
      }
      removedFiles[bucket] = paths.length;
    }
  } catch (e) {
    return json({ error: 'storage_failed', message: (e as Error).message }, 500);
  }

  // 2. Konto i dane (kaskada z auth.users).
  const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
  if (deleteError) return json({ error: 'delete_failed', message: deleteError.message }, 500);

  return json({ deleted: true, authUserDeleted: true, removedFiles });
});
