import type { Badge, Quest } from '@/types';

/** Odznaki w kolejności z profilu (makieta: 5 odznak, ostatnia zablokowana). */
export const BADGES: Badge[] = [
  {
    id: 'krol-puszczy',
    name: 'Król Puszczy',
    icon: 'military_tech',
    color: '#EFA831',
    iconColor: '#4A3200',
    description: '10 borowików w Puszczy Knyszyńskiej',
  },
  {
    id: 'ranny-ptaszek',
    name: 'Ranny ptaszek',
    icon: 'wb_twilight',
    color: '#2B99E7',
    iconColor: '#0E2442',
    description: 'Wyprawa rozpoczęta przed 6:00',
  },
  {
    id: 'km-100',
    name: '100 km',
    icon: 'hiking',
    color: '#7FB547',
    iconColor: '#1F3310',
    description: '100 km przebytych na wyprawach',
  },
  {
    id: 'seria-7',
    name: 'Seria 7 dni',
    icon: 'local_fire_department',
    color: '#A56CDE',
    iconColor: '#2A0D3A',
    description: '7 dni z rzędu w lesie',
  },
  {
    id: 'lowca-legend',
    name: 'Łowca Legend',
    icon: 'diamond',
    color: '#EFA831',
    iconColor: '#4A3200',
    description: 'Znajdź gatunek legendarny',
  },
];

export const DAILY_QUESTS: Quest[] = [
  {
    id: 'q-scan-5',
    kind: 'scans',
    title: 'Zeskanuj 5 grzybów',
    icon: 'photo_camera',
    iconBg: '#EEF5E3',
    iconColor: '#4C7A22',
    xp: 100,
    target: 5,
  },
  {
    id: 'q-rare-1',
    kind: 'rare',
    title: 'Znajdź rzadki gatunek',
    icon: 'diamond',
    iconFilled: true,
    iconBg: '#E9EEF9',
    iconColor: '#0068B2',
    xp: 150,
    target: 1,
  },
  {
    id: 'q-km-5',
    kind: 'distance',
    title: 'Przejdź 5 km',
    icon: 'hiking',
    iconBg: '#FFF0DD',
    iconColor: '#A2560F',
    xp: 80,
    target: 5,
  },
];
