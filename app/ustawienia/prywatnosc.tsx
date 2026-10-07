import { LegalDocView } from '@/components/LegalDocView';
import { POLITYKA_PRYWATNOSCI } from '@/data/legal';

/** Ustawienia → Informacje prawne → Polityka prywatności (szkic, treść w src/data/legal.ts). */
export default function PrivacyPolicyScreen() {
  return <LegalDocView doc={POLITYKA_PRYWATNOSCI} />;
}
