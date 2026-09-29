import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('test1@gmail.com');
  const [password, setPassword] = useState('123456');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handle = async () => {
    if (!email || !password) return Alert.alert('Thiếu thông tin');
    setLoading(true);
    try {
      await login(email, password);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Lỗi đăng nhập', e.response?.data?.message || e.message);
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Đăng nhập</Text>
      <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry />
      <TouchableOpacity style={styles.btn} onPress={handle} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Đang đăng nhập...' : 'Đăng nhập'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('Register')}>
        <Text style={styles.link}>Chưa có tài khoản? Đăng ký</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>Phase 2: JWT lưu SecureStore, reload app vẫn giữ đăng nhập</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  container:{flex:1, padding:20, justifyContent:'center', backgroundColor:'#fff'},
  title:{fontSize:24, fontWeight:'900', textAlign:'center', marginBottom:20},
  input:{borderWidth:1, borderColor:'#ddd', borderRadius:10, padding:14, marginBottom:12},
  btn:{backgroundColor:'#FF6A00', padding:14, borderRadius:10, alignItems:'center'},
  btnText:{color:'#fff', fontWeight:'800'},
  link:{textAlign:'center', marginTop:14, color:'#0066cc'},
  hint:{textAlign:'center', marginTop:18, color:'#888', fontSize:12}
});
