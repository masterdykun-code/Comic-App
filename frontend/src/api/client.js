import axios from 'axios';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const API_PORT = '3000';

function getLanHost() {
  // Khi chạy `expo start --host lan`, Expo expose hostUri dạng "192.168.1.3:8081"
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    null;
  if (!hostUri) return null;
  const m = String(hostUri).match(/(\d+\.\d+\.\d+\.\d+|[\w-]+\.local|localhost)/);
  return m ? m[1] : null;
}

function resolveBaseURL() {
  // 1. Ưu tiên env — dùng cho điện thoại thật, khỏi sửa code mỗi lần đổi WiFi.
  //    Tạo file frontend/.env: EXPO_PUBLIC_API_URL=http://192.168.1.3:3000/api
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  // 2. Web luôn dùng localhost của PC.
  if (Platform.OS === 'web') return `http://localhost:${API_PORT}/api`;
  // 3. Native + chạy --host lan: tự lấy IP PC từ hostUri, điện thoại thật dùng được ngay.
  const lanHost = getLanHost();
  if (lanHost && lanHost !== 'localhost') return `http://${lanHost}:${API_PORT}/api`;
  // 4. Fallback: giả lập Android Studio (10.0.2.2 = localhost của PC nhìn từ emulator).
  if (Platform.OS === 'android') return `http://10.0.2.2:${API_PORT}/api`;
  // 5. iOS simulator / còn lại.
  return `http://localhost:${API_PORT}/api`;
}

const baseURL = resolveBaseURL();
if (__DEV__) console.log('[API] baseURL =', baseURL);

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

export { baseURL };

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
