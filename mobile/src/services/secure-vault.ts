import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { RefreshVault } from '../types/auth';
import { ApiError } from '../lib/errors';
import { diagnostic, failureDetails } from '../lib/diagnostics';
export const REFRESH_KEY = 'webnovel.reader.refresh.v1';
export function createRefreshVault(platform = Platform.OS): RefreshVault {
  let volatile: string | null = null;
  if (platform === 'web')
    return {
      async get() {
        return volatile;
      },
      async set(value) {
        volatile = value;
      },
      async remove() {
        volatile = null;
      },
    };
  async function available() {
    if (!(await SecureStore.isAvailableAsync()))
      throw new ApiError(503, 'Kho lưu phiên an toàn chưa sẵn sàng.');
  }
  return {
    async get() {
      diagnostic('vault.read.start');
      try {
        await available();
        const value = await SecureStore.getItemAsync(REFRESH_KEY);
        diagnostic('vault.read.complete');
        return value;
      } catch (error) {
        diagnostic('vault.read.fail', failureDetails(error));
        throw error;
      }
    },
    async set(value) {
      await available();
      await SecureStore.setItemAsync(REFRESH_KEY, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
    async remove() {
      await available();
      await SecureStore.deleteItemAsync(REFRESH_KEY);
    },
  };
}
