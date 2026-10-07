import { useEffect, useMemo } from 'react';
import type { ImageSourcePropType } from 'react-native';

import { findPhotoSource } from '@/services/live/findPhotos';
import { REFRESH_BEFORE_MS, requestRemotePhoto, useRemotePhotoUrls } from '@/services/supabase/remotePhotos';
import { remotePhotoPath } from '@/utils/findPhoto';

/**
 * Źródło obrazu zdjęcia znaleziska (`Find.photoUri`): lokalny plik / data URI jak dotąd (findPhotoSource), a znacznik
 * zdjęcia z serwera (`sb-photo:`, web w trybie Supabase) → podpisany adres pobierany w tle; do tego czasu undefined
 * (paski z makiety). Adres odświeża się przed wygaśnięciem, także gdy ekran jest otwarty.
 */
export function useFindPhotoSource(uri?: string): ImageSourcePropType | undefined {
  const path = remotePhotoPath(uri);
  const url = useRemotePhotoUrls((s) => (path ? s.urls[path]?.url : undefined));
  const expiresAt = useRemotePhotoUrls((s) => (path ? s.urls[path]?.expiresAt : undefined));

  useEffect(() => {
    if (!path) return;
    requestRemotePhoto(path);
    if (expiresAt == null) return;
    const t = setTimeout(() => requestRemotePhoto(path), Math.max(1_000, expiresAt - Date.now() - REFRESH_BEFORE_MS + 1_000));
    return () => clearTimeout(t);
  }, [path, expiresAt]);

  return useMemo(() => (path ? (url ? { uri: url } : undefined) : findPhotoSource(uri)), [path, url, uri]);
}
