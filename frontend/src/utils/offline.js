// Lưu chương offline bằng FILE (expo-file-system) thay vì SecureStore.
// Lý do: SecureStore giới hạn ~2KB/giá trị trên Android -> lưu nội dung chương toàn fail im lặng.
import { Platform } from 'react-native';

const INDEX_KEY = 'offline_index_v2';
const MAX_ITEMS = 50;

let FS = null;
if (Platform.OS !== 'web') {
  try {
    FS = require('expo-file-system/legacy');
  } catch {
    FS = null;
  }
}

const dirOf = () => (FS?.documentDirectory || '') + 'offline/';
const fileOf = (novelId, chapterNumber) => dirOf() + `${Number(novelId)}_${Number(chapterNumber)}.json`;

async function ensureDir() {
  if (!FS) return;
  const info = await FS.getInfoAsync(dirOf());
  if (!info.exists) await FS.makeDirectoryAsync(dirOf(), { intermediates: true });
}

// ---- index (danh sách meta) ----
async function readIndex() {
  try {
    if (Platform.OS === 'web' || !FS) {
      const raw = (typeof localStorage !== 'undefined' && localStorage.getItem(INDEX_KEY)) || '[]';
      const arr = JSON.parse(raw || '[]');
      return Array.isArray(arr) ? arr : [];
    }
    await ensureDir();
    const info = await FS.getInfoAsync(dirOf() + 'index.json');
    if (!info.exists) return [];
    const arr = JSON.parse(await FS.readAsStringAsync(dirOf() + 'index.json'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeIndex(list) {
  if (Platform.OS === 'web' || !FS) {
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch {}
    return;
  }
  await ensureDir();
  await FS.writeAsStringAsync(dirOf() + 'index.json', JSON.stringify(list));
}

export async function listOfflineChapters() {
  const idx = await readIndex();
  // Lọc mục còn file thật (tránh treo mục rác)
  if (Platform.OS === 'web' || !FS) return idx;
  const alive = [];
  for (const m of idx) {
    const info = await FS.getInfoAsync(fileOf(m.novelId, m.chapterNumber)).catch(() => null);
    if (info?.exists) alive.push(m);
  }
  if (alive.length !== idx.length) await writeIndex(alive);
  return alive;
}

export async function getOfflineChapter(novelId, chapterNumber) {
  const nId = Number(novelId);
  const cNum = Number(chapterNumber);
  try {
    if (Platform.OS === 'web' || !FS) {
      const idx = await readIndex();
      return idx.find((x) => Number(x.novelId) === nId && Number(x.chapterNumber) === cNum) || null;
    }
    const info = await FS.getInfoAsync(fileOf(nId, cNum));
    if (!info.exists) return null;
    return JSON.parse(await FS.readAsStringAsync(fileOf(nId, cNum)));
  } catch {
    return null;
  }
}

export async function saveOfflineChapter({ novelId, chapterNumber, title, content, novelTitle }) {
  const item = {
    novelId: Number(novelId),
    chapterNumber: Number(chapterNumber),
    title: title || `Chương ${chapterNumber}`,
    novelTitle: novelTitle || '',
    content: String(content || ''),
    savedAt: new Date().toISOString(),
  };
  if (!item.content) return { ok: false, message: 'Chương chưa có nội dung' };
  try {
    if (Platform.OS === 'web' || !FS) {
      const idx = (await readIndex()).filter(
        (x) => !(Number(x.novelId) === item.novelId && Number(x.chapterNumber) === item.chapterNumber));
      await writeIndex([item, ...idx].slice(0, MAX_ITEMS));
      return { ok: true };
    }
    await ensureDir();
    await FS.writeAsStringAsync(fileOf(item.novelId, item.chapterNumber), JSON.stringify(item));
    const { content: _drop, ...meta } = item;
    const idx = (await readIndex()).filter(
      (x) => !(Number(x.novelId) === item.novelId && Number(x.chapterNumber) === item.chapterNumber));
    await writeIndex([meta, ...idx].slice(0, MAX_ITEMS));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

export async function removeOfflineChapter(novelId, chapterNumber) {
  const nId = Number(novelId);
  const cNum = Number(chapterNumber);
  try {
    if (Platform.OS !== 'web' && FS) {
      await FS.deleteAsync(fileOf(nId, cNum), { idempotent: true });
    }
    const idx = (await readIndex()).filter(
      (x) => !(Number(x.novelId) === nId && Number(x.chapterNumber) === cNum));
    await writeIndex(idx);
  } catch {}
}

export async function clearOfflineChapters() {
  try {
    if (Platform.OS !== 'web' && FS) {
      const info = await FS.getInfoAsync(dirOf());
      if (info.exists) await FS.deleteAsync(dirOf(), { idempotent: true });
      await ensureDir();
    }
    await writeIndex([]);
  } catch {}
}
