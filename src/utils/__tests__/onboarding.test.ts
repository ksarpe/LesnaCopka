import { describe, expect, it } from '@jest/globals';

import { LEGAL_DOCS } from '@/data/legal';
import { consentText, ONBOARDING_CONSENT, ONBOARDING_CTA, shouldAdoptHomeGmina } from '../onboarding';

describe('onboarding – oświadczenie przy przycisku', () => {
  it('cytuje napis z przycisku i linkuje oba dokumenty (każdy raz)', () => {
    expect(consentText()).toContain(`„${ONBOARDING_CTA}”`);
    const docs = ONBOARDING_CONSENT.filter((p) => p.doc).map((p) => p.doc);
    expect(docs.sort()).toEqual(LEGAL_DOCS.map((d) => d.id).sort());
  });

  it('regulamin z zasadami bezpieczeństwa – akceptacja; polityka – „znasz” (informacja, nie zgoda); 16 lat', () => {
    const t = consentText();
    expect(t).toMatch(/akceptujesz Regulamin \(w tym zasady bezpieczeństwa\)/);
    expect(t).toMatch(/znasz Politykę prywatności/);
    expect(t).not.toMatch(/akceptujesz Politykę/);
    expect(t).toMatch(/ukończone 16 lat/);
    expect(t).toMatch(/zgodą rodzica lub opiekuna/);
  });
});

describe('onboarding – gmina domowa z GPS', () => {
  it('tylko gdy gracz jej nie wybrał; z serwerem – dopiero po pierwszym przyjęciu stanu konta', () => {
    expect(shouldAdoptHomeGmina({ pending: false, serverMode: false, synced: false })).toBe(false);
    expect(shouldAdoptHomeGmina({ pending: true, serverMode: false, synced: false })).toBe(true);
    expect(shouldAdoptHomeGmina({ pending: true, serverMode: true, synced: false })).toBe(false);
    expect(shouldAdoptHomeGmina({ pending: true, serverMode: true, synced: true })).toBe(true);
    expect(shouldAdoptHomeGmina({ pending: false, serverMode: true, synced: true })).toBe(false);
  });
});
