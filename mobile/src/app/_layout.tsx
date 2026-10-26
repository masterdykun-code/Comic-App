import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProviders, SessionBoundary } from '../lib/providers';
export default function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="dark" />
      <SessionBoundary>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="search" />
          <Stack.Screen name="rankings" />
          <Stack.Screen name="story/[id]" />
          <Stack.Screen name="reader/[id]" />
          <Stack.Screen name="account" />
          <Stack.Screen name="history" />
          <Stack.Screen name="bookmarks" />
          <Stack.Screen name="wallet" />
          <Stack.Screen name="feedback/[id]" />
        </Stack>
      </SessionBoundary>
    </AppProviders>
  );
}
