import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handle = async () => {
    if (!email.trim() || !password) return Alert.alert('Thiếu email/mật khẩu');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    } catch (e) {
      Alert.alert('Lỗi đăng nhập', e.response?.data?.message || e.message);
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Đăng nhập</Text>
      <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <View style={styles.pwRow}>
        <TextInput style={[styles.input, { flex: 1, marginBottom: 0, borderWidth: 0 }]} placeholder="Mật khẩu (≥6 ký tự)" value={password} onChangeText={setPassword} secureTextEntry={!showPw} />
        <TouchableOpacity onPress={() => setShowPw(!showPw)}><Text style={{ fontSize: 12, color: '#0066cc', fontWeight: '700' }}>{showPw ? 'Ẩn' : 'Hiện'}</Text></TouchableOpacity>
      </View>
      <TouchableOpacity style={[styles.btn, { marginTop: 12 }]} onPress={handle} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Đang đăng nhập...' : 'Đăng nhập'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.navigate('Register')}>
        <Text style={styles.link}>Chưa có tài khoản? Đăng ký</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>Đăng nhập để dùng kệ sách, bình luận, coins và viết truyện</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  container:{flex:1, padding:20, justifyContent:'center', backgroundColor:'#fff'},
  title:{fontSize:24, fontWeight:'900', textAlign:'center', marginBottom:20},
  input:{borderWidth:1, borderColor:'#ddd', borderRadius:10, padding:14, marginBottom:12},
  pwRow:{flexDirection:'row', alignItems:'center', borderWidth:1, borderColor:'#ddd', borderRadius:10, paddingRight:12},
  btn:{backgroundColor:'#FF6A00', padding:14, borderRadius:10, alignItems:'center'},
  btnText:{color:'#fff', fontWeight:'800'},
  link:{textAlign:'center', marginTop:14, color:'#0066cc'},
  hint:{textAlign:'center', marginTop:18, color:'#888', fontSize:12}
});
