/**
 * Narzędzia deweloperskie w seedzie (scripts/gen-seed.ts → supabase/seed.sql; test: scripts/db-tests/20-uszczelnienia.mjs).
 *
 * Migracje NIE nadają klientom EXECUTE na funkcjach `public.dev_*` (20261015103000_uszczelnienia.sql odbiera je pętlą).
 * Seed lokalny włącza `app_config.dev_tools` i nadaje EXECUTE dla `authenticated` funkcjom `dev_*`, które same sprawdzają
 * `dev_tools_enabled()` (RPC deweloperskie – także przyszłe, np. dev_seed_rivalry), oraz samej `dev_tools_enabled`
 * (panel /dev). Wewnętrzne pomocniki (dev_ensure_bot, dev_seed_voivodeship) zostają bez EXECUTE.
 * Seed do chmury (`--cloud`) wyłącza flagę i odbiera EXECUTE na wszystkich `dev_*` – także po pomyłkowym seedzie lokalnym.
 */

/** Funkcje `public.dev_*` (pg_proc) – warunek SQL; `self` = tylko RPC strzeżone przez dev_tools_enabled(). */
const devFunctions = (self: boolean) =>
  [
    'select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace',
    `     where n.nspname = 'public' and p.proname like 'dev\\_%'`,
    ...(self ? [`       and (p.proname = 'dev_tools_enabled' or p.prosrc like '%dev_tools_enabled()%')`] : []),
  ].join('\n');

export function devToolsSeedSql(cloud: boolean): string[] {
  const loop = (sql: string, action: string) => [
    'do $$',
    'declare',
    '  f regprocedure;',
    'begin',
    `  for f in ${sql}`,
    '  loop',
    `    execute format('${action}', f);`,
    '  end loop;',
    'end $$;',
  ];
  return cloud
    ? [
        '-- Chmura: narzędzia deweloperskie wyłączone, funkcje dev_* bez EXECUTE dla klientów.',
        "insert into public.app_config (key, value) values ('dev_tools', 'false')",
        'on conflict (key) do update set value = excluded.value;',
        ...loop(devFunctions(false), 'revoke all on function %s from public, anon, authenticated'),
        '',
      ]
    : [
        '-- LOKALNIE: narzędzia deweloperskie włączone (import stanu, reset gracza, boty). Do chmury: npm run db:seed -- --cloud.',
        "insert into public.app_config (key, value) values ('dev_tools', 'true')",
        'on conflict (key) do update set value = excluded.value;',
        '-- EXECUTE na RPC dev_* (same sprawdzają dev_tools_enabled()) – tylko z seeda lokalnego, migracje go nie nadają.',
        ...loop(devFunctions(true), 'grant execute on function %s to authenticated'),
        '',
      ];
}
