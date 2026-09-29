import React, { createContext, useState, useEffect, useContext } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import client, { saveToken, removeToken } from '../api/client';

const AuthContext = createContext();

// SecureStore không chạy trên web -> dùng localStorage để khỏi treo app
async function getStoredToken() {
  try {
    if (Platform.OS === 'web') return localStorage.getItem('jwt_token');
    return await SecureStore.getItemAsync('jwt_token');
  } catch { return null; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await getStoredToken();
        if (token) {
          const res = await client.get('/auth/me');
          setUser(res.data);
        }
      } catch (e) { try { await removeToken(); } catch {} }
      setLoading(false);
    })();
  }, []);

  const login = async (email, password) => {
    const res = await client.post('/auth/login', { email, password });
    await saveToken(res.data.token);
    setUser(res.data.user);
    return res.data;
  };

  const register = async (username, email, password) => {
    const res = await client.post('/auth/register', { username, email, password });
    // auto login after register
    await login(email, password);
    return res.data;
  };

  const logout = async () => {
    await removeToken();
    setUser(null);
  };

  const refresh = async () => {
    try {
      const res = await client.get('/auth/me');
      setUser(res.data);
      return res.data;
    } catch { return null; }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh, isLoggedIn: !!user, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
