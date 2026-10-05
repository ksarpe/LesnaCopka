import { createContext, useContext, type ReactNode } from 'react';

import { mockServices } from './mock';
import { supabaseEnabled } from './supabase/client';
import { createSupabaseServices } from './supabase';
import type { Services } from './types';

export * from './types';

/** EXPO_PUBLIC_BACKEND=supabase (.env.local) → serwisy Supabase, w przeciwnym razie mocki. */
const defaultServices: Services = supabaseEnabled ? createSupabaseServices(mockServices) : mockServices;

const ServicesContext = createContext<Services>(defaultServices);

/** Kontener serwisów. Podmiana mock → API: <ServicesProvider value={apiServices}>. */
export function ServicesProvider({ value = defaultServices, children }: { value?: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  return useContext(ServicesContext);
}
