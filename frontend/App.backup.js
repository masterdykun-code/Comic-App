import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import BookshelfScreen from './src/screens/BookshelfScreen';
import FeaturedScreen from './src/screens/FeaturedScreen';
import WriteScreen from './src/screens/WriteScreen';
import LibraryScreen from './src/screens/LibraryScreen';
import AccountScreen from './src/screens/AccountScreen';
import NovelDetailScreen from './src/screens/NovelDetailScreen';
import ReaderScreen from './src/screens/ReaderScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#000',
        tabBarInactiveTintColor: '#999',
        tabBarStyle: { height: 60, paddingBottom: 6 },
      }}
    >
      <Tab.Screen name="Giá sách" component={BookshelfScreen}
        options={{ tabBarIcon: ({color, size}) => <Ionicons name="book" size={size} color={color} /> }} />
      <Tab.Screen name="Nổi bật" component={FeaturedScreen}
        options={{ tabBarIcon: ({color, size}) => <Ionicons name="star" size={size} color={color} /> }} />
      <Tab.Screen name="Viết" component={WriteScreen}
        options={{ tabBarIcon: ({color, size}) => <Ionicons name="create-outline" size={size} color={color} /> }} />
      <Tab.Screen name="Kho sách" component={LibraryScreen}
        options={{ tabBarIcon: ({color, size}) => <MaterialCommunityIcons name="orbit" size={size} color={color} /> }} />
      <Tab.Screen name="Tài khoản" component={AccountScreen}
        options={{ tabBarIcon: ({color, size}) => <Ionicons name="person-circle-outline" size={size} color={color} /> }} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Stack.Navigator>
          <Stack.Screen name="MainTabs" component={Tabs} options={{ headerShown: false }} />
          <Stack.Screen name="NovelDetail" component={NovelDetailScreen} options={{ title: 'Chi tiết truyện', headerTintColor: '#000' }} />
          <Stack.Screen name="Reader" component={ReaderScreen} options={{ headerShown: false }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
