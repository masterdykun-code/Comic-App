import axios from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

let baseURL = 'http://10.0.2.2:3000/api';
if (Platform.OS === 'web') baseURL = 'http://localhost:3000/api';
// Nếu chạy Expo Go qua LAN, đổi thành IP máy: npx expo start --host lan rồi lấy IP trong QR

const client = axios.create({ baseURL, timeout: 8000 });

// Interceptor tự gắn JWT (dùng helper web-safe)
client.interceptors.request.use(async (config) => {
  try {
    const token = await getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch (e) {}
  return config;
});

export default client;

// helpers (web-safe: SecureStore không chạy trên web)
export async function saveToken(token) {
  if (Platform.OS === 'web') { localStorage.setItem('jwt_token', token); return; }
  await SecureStore.setItemAsync('jwt_token', token);
}
export async function getToken() {
  if (Platform.OS === 'web') return localStorage.getItem('jwt_token');
  return await SecureStore.getItemAsync('jwt_token');
}
export async function removeToken() {
  try {
    if (Platform.OS === 'web') { localStorage.removeItem('jwt_token'); return; }
    await SecureStore.deleteItemAsync('jwt_token');
  } catch {}
}
