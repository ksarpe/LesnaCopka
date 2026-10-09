/**
 * Akcje pojedynków wspólne dla ekranów Pojedynki i Pojedynek: przyjęcie, odrzucenie (z pytaniem), anulowanie
 * (z pytaniem) i komunikaty. Wywołania DuelService; logika i teksty – src/utils/duels.ts.
 */
import { ServiceError, type DuelService } from '@/services/types';
import type { Duel } from '@/types';
import { looksFeminine } from '@/utils/activity';
import { ui } from './useUiStore';

/** Błąd akcji pojedynku → toast: bez sieci – krótko, odmowa serwera – jej powód po polsku. */
export function duelActionFailed(e: unknown) {
  if (e instanceof ServiceError && e.code === 'NETWORK') ui.toast('Brak połączenia – spróbuj, gdy będzie internet', 'wifi_off');
  else ui.toast(e instanceof Error && e.message ? e.message : 'Nie udało się – spróbuj ponownie', 'error');
}

/** Przyjęcie wyzwania. Zwraca pojedynek po zmianie albo null (błąd – już pokazany). */
export async function acceptDuel(duels: DuelService, d: Duel): Promise<Duel | null> {
  try {
    const next = await duels.respondDuel(d.id, true);
    ui.toast('Pojedynek rozpoczęty – powodzenia!', 'bolt');
    return next;
  } catch (e) {
    duelActionFailed(e);
    return null;
  }
}

/** „Odrzuć” – po potwierdzeniu; `done` po udanym zapisie. */
export function declineDuel(duels: DuelService, d: Duel, done: () => void) {
  ui.confirm({
    title: 'Odrzucić wyzwanie?',
    message: `${d.opponent.user.name} dostanie informację, że pojedynek się nie odbędzie.`,
    icon: 'close',
    confirmLabel: 'Odrzuć',
    onConfirm: () =>
      void duels.respondDuel(d.id, false).then(
        () => {
          ui.toast('Wyzwanie odrzucone', 'close');
          done();
        },
        duelActionFailed,
      ),
  });
}

/** „Anuluj wyzwanie” – po potwierdzeniu; `done` po udanym zapisie. */
export function cancelDuel(duels: DuelService, d: Duel, done: () => void) {
  const name = d.opponent.user.name;
  ui.confirm({
    title: 'Anulować wyzwanie?',
    message: `${name} jeszcze nie ${looksFeminine(name) ? 'odpowiedziała' : 'odpowiedział'} – wyzwanie zniknie.`,
    icon: 'undo',
    confirmLabel: 'Anuluj wyzwanie',
    cancelLabel: 'Zostaw',
    onConfirm: () =>
      void duels.cancelDuel(d.id).then(
        () => {
          ui.toast('Wyzwanie anulowane', 'undo');
          done();
        },
        duelActionFailed,
      ),
  });
}
