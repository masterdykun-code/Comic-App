import { View, Text, Image, StyleSheet } from 'react-native';
import { useState } from 'react';
import theme from '../theme';

// Ảnh bìa chống xám: uri null/hỏng -> hiện chữ cái đầu trên nền cam nhạt
export default function SafeCover({ uri, title = '?', style, imgStyle }) {
  const [err, setErr] = useState(false);
  const merged = StyleSheet.flatten([styles.box, style]);
  const w = merged?.width || 100;
  const h = merged?.height || 140;
  if (!uri || err) {
    return (
      <View style={[styles.box, { width: w, height: h }, style]}>
        <Text style={styles.letter}>{String(title || '?').trim().charAt(0).toUpperCase()}</Text>
        <Text style={styles.sub} numberOfLines={2}>{title}</Text>
      </View>
    );
  }
  return (
    <View style={[{ width: w, height: h }, style]}>
      <Image
        source={{ uri }}
        style={[{ width: w, height: h }, styles.img, imgStyle]}
        onError={() => setErr(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#FFE8D6',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
    overflow: 'hidden',
  },
  img: { borderRadius: 8, backgroundColor: '#FFE8D6' },
  letter: { fontSize: 32, fontWeight: '900', color: theme.primaryDark },
  sub: { fontSize: 10, color: '#8A6A55', textAlign: 'center', marginTop: 2 },
});
