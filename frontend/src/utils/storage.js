import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Universal key-value cho setting nhỏ. Native dùng SecureStore, web dùng localStorage.
// Không cần cài thêm async-storage để tránh vỡ deps khi bảo vệ.
export async function getSetting(key, fallback = null) {
  try {
    if (Platform.OS === 'web') {
      const v = localStorage.getItem(key);
      return v !== null ? v : fallback;
    }
    const v = await SecureStore.getItemAsync(key);
    return v !== null && v !== undefined ? v : fallback;
  } catch {
    return fallback;
  }
}

export async function setSetting(key, value) {
  try {
    const v = String(value);
    if (Platform.OS === 'web') {
      localStorage.setItem(key, v);
    } else {
      await SecureStore.setItemAsync(key, v);
    }
  } catch {}
}

export const READER_KEYS = {
  FONT_SIZE: 'reader_font_size',
  THEME: 'reader_theme',
  LINE_HEIGHT: 'reader_line_height',
};
