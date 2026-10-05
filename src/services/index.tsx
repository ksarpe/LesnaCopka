import { createContext, useContext, type ReactNode } from 'react';

import { mockServices } from './mock';
import type { Services } from './types';

export * from './types';

const ServicesContext = createContext<Services>(mockServices);

/** Kontener serwisów. Podmiana mock → API: <ServicesProvider value={apiServices}>. */
export function ServicesProvider({ value = mockServices, children }: { value?: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  return useContext(ServicesContext);
}
