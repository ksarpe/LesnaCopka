import { LegalDocView } from '@/components/LegalDocView';
import { REGULAMIN } from '@/data/legal';

/** Ustawienia → Informacje prawne → Regulamin (szkic, treść w src/data/legal.ts). */
export default function RegulaminScreen() {
  return <LegalDocView doc={REGULAMIN} />;
}
