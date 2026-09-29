import 'react-native-gesture-handler';
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import BookshelfScreen from './src/screens/BookshelfScreen';
import FeaturedScreen from './src/screens/FeaturedScreen';
import WriteScreen from './src/screens/WriteScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import AccountScreen from './src/screens/AccountScreen';
import NovelDetailScreen from './src/screens/NovelDetailScreen';
import ReaderScreen from './src/screens/ReaderScreen';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import theme from './src/theme';
import { AuthProvider } from './src/context/AuthContext';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

class ErrorBoundary extends React.Component {
  state = { error: null, stack: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('App ErrorBoundary', error, info); this.setState({ stack: info.componentStack }); }
  render() {
    if (this.state.error) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>❌ App lỗi</Text>
          <Text style={styles.errorText}>{String(this.state.error.message || this.state.error)}</Text>
          <Text style={styles.errorStack}>{String(this.state.stack || '').slice(0,1500)}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: theme.primary, tabBarInactiveTintColor: '#999', tabBarStyle: { height: 60, paddingBottom: 6, backgroundColor: '#fff' } }}>
      <Tab.Screen name="Giá sách" component={BookshelfScreen} options={{ tabBarIcon: ({color,size}) => <Ionicons name="book" size={size} color={color} /> }} />
      <Tab.Screen name="Nổi bật" component={FeaturedScreen} options={{ tabBarIcon: ({color,size}) => <Ionicons name="star" size={size} color={color} /> }} />
      <Tab.Screen name="Viết" component={WriteScreen} options={{ tabBarIcon: ({color,size}) => <Ionicons name="create-outline" size={size} color={color} /> }} />
      <Tab.Screen name="Kho sách" component={LibraryScreen} options={{ tabBarIcon: ({color,size}) => <MaterialCommunityIcons name="orbit" size={size} color={color} /> }} />
      <Tab.Screen name="Tài khoản" component={AccountScreen} options={{ tabBarIcon: ({color,size}) => <Ionicons name="person-circle-outline" size={size} color={color} /> }} />
    </Tab.Navigator>
  );
}

export default function App() {
  console.log('✅ App mounted', Platform.OS);
  return (
    <GestureHandlerRootView style={{flex:1}}>
      <AuthProvider>
        <ErrorBoundary>
          <NavigationContainer linking={{ prefixes: [] }} fallback={<View style={styles.loading}><Text>Loading...</Text></View>}>
            <Stack.Navigator>
              <Stack.Screen name="MainTabs" component={Tabs} options={{ headerShown: false }} />
              <Stack.Screen name="NovelDetail" component={NovelDetailScreen} options={{ title: 'Chi tiết truyện' }} />
              <Stack.Screen name="Reader" component={ReaderScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Đăng nhập' }} />
              <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Đăng ký' }} />
            </Stack.Navigator>
          </NavigationContainer>
        </ErrorBoundary>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  errorContainer: { flex:1, justifyContent:'center', alignItems:'center', padding:20, backgroundColor:'#fff' },
  errorTitle: { fontSize:18, fontWeight:'900', color:'red', marginBottom:10 },
  errorText: { color:'#333', textAlign:'center' },
  errorStack: { color:'#888', fontSize:10, marginTop:10 },
  loading: { flex:1, justifyContent:'center', alignItems:'center' },
});
