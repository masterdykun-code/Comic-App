import * as SecureStore from 'expo-secure-store';
import { createRefreshVault, REFRESH_KEY } from '../src/services/secure-vault';
test('native vault uses SecureStore for refresh only, with device-only unlock policy', async () => {
  const vault = createRefreshVault('android');
  await vault.set('synthetic-refresh');
  await vault.get();
  await vault.remove();
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(REFRESH_KEY, 'synthetic-refresh', {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  expect(SecureStore.getItemAsync).toHaveBeenCalledWith(REFRESH_KEY);
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(REFRESH_KEY);
});
test('web preview keeps refresh only in memory, without calling native storage', async () => {
  const vault = createRefreshVault('web');
  await vault.set('synthetic-refresh');
  expect(await vault.get()).toBe('synthetic-refresh');
  await vault.remove();
  expect(await vault.get()).toBeNull();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
test('unavailable native SecureStore fails closed without plaintext fallback', async () => {
  jest.mocked(SecureStore.isAvailableAsync).mockResolvedValueOnce(false);
  const vault = createRefreshVault('android');
  await expect(vault.set('synthetic-refresh')).rejects.toMatchObject({ status: 503 });
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
