import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function RegisterScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();

  const handle = async () => {
    if (!username || !email || !password) return Alert.alert('Thiếu thông tin');
    setLoading(true);
    try {
      await register(username, email, password);
      Alert.alert('Thành công', 'Đã đăng ký và tự đăng nhập');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Lỗi', e.response?.data?.message || e.message);
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Đăng ký</Text>
      <TextInput style={styles.input} placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Mật khẩu" value={password} onChangeText={setPassword} secureTextEntry />
      <TouchableOpacity style={styles.btn} onPress={handle} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Đang xử lý...' : 'Đăng ký'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.link}>Đã có tài khoản? Đăng nhập</Text>
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  container:{flex:1, padding:20, justifyContent:'center', backgroundColor:'#fff'},
  title:{fontSize:24, fontWeight:'900', textAlign:'center', marginBottom:20},
  input:{borderWidth:1, borderColor:'#ddd', borderRadius:10, padding:14, marginBottom:12},
  btn:{backgroundColor:'#FF6A00', padding:14, borderRadius:10, alignItems:'center'},
  btnText:{color:'#fff', fontWeight:'800'},
  link:{textAlign:'center', marginTop:14, color:'#0066cc'}
});
