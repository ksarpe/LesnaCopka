/**
 * Kafle mapy na telefonie (iOS / Android): `dokumenty/tiles/<z>/<x>/<y>.pbf` + indeks `dokumenty/tiles/index.json`.
 * Katalog dokumentów (nie cache) – system go nie czyści, więc mapa offline jest na miejscu w lesie.
 * Web: tileBackend.web.ts (IndexedDB).
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { TileBackend } from './tileStore';

const ROOT = 'tiles';
const INDEX = 'index.json';

const baseName = (uri: string) => uri.replace(/\/+$/, '').split('/').pop() ?? '';

export function openTileBackend(): TileBackend | null {
  let root: Directory;
  try {
    root = new Directory(Paths.document, ROOT);
  } catch {
    return null;
  }
  /** Katalogi `z/x` już utworzone w tej sesji (create() to wywołanie natywne). */
  const made = new Set<string>();

  const parts = (key: string) => key.split('/');
  const fileOf = (key: string) => {
    const [z, x, y] = parts(key);
    return new File(root, z, x, `${y}.pbf`);
  };
  const ensureDir = (key: string, force = false) => {
    const [z, x] = parts(key);
    const id = `${z}/${x}`;
    if (made.has(id) && !force) return;
    new Directory(root, z, x).create({ intermediates: true, idempotent: true });
    made.add(id);
  };
  const writeFile = (key: string, bytes: Uint8Array) => {
    const f = fileOf(key);
    // Pusty kafel (204 – brak danych) jako pusty plik: zapis tekstu nie wymaga wskaźnika na bajty.
    if (bytes.length) f.write(bytes);
    else f.write('');
  };

  return {
    kind: 'file',
    async get(key) {
      const f = fileOf(key);
      if (!f.exists) return null;
      return await f.bytes();
    },
    async put(key, bytes) {
      ensureDir(key);
      try {
        writeFile(key, bytes);
      } catch {
        // katalog zniknął (np. usunięty obszar) – utwórz ponownie i spróbuj raz jeszcze
        ensureDir(key, true);
        writeFile(key, bytes);
      }
    },
    async remove(keys) {
      for (const k of keys) {
        try {
          const f = fileOf(k);
          if (f.exists) f.delete();
        } catch {
          // już usunięty
        }
      }
    },
    async keys() {
      if (!root.exists) return [];
      const out: string[] = [];
      for (const zr of root.listAsRecords()) {
        const z = baseName(zr.uri);
        if (!zr.isDirectory || !/^\d+$/.test(z)) continue;
        for (const xr of new Directory(zr.uri).listAsRecords()) {
          const x = baseName(xr.uri);
          if (!xr.isDirectory || !/^\d+$/.test(x)) continue;
          for (const fr of new Directory(xr.uri).listAsRecords()) {
            const name = baseName(fr.uri);
            if (!fr.isDirectory && /^\d+\.pbf$/.test(name)) out.push(`${z}/${x}/${name.slice(0, -4)}`);
          }
        }
      }
      return out;
    },
    async size(key) {
      const f = fileOf(key);
      return f.exists ? f.size : null;
    },
    async readIndex() {
      const f = new File(root, INDEX);
      return f.exists ? await f.text() : null;
    },
    async writeIndex(json) {
      if (!root.exists) root.create({ intermediates: true, idempotent: true });
      new File(root, INDEX).write(json);
    },
  };
}
