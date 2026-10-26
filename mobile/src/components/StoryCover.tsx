import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { BookOpen } from 'lucide-react-native';
import { colors, radius } from '../lib/theme';

export function StoryCover({
  url,
  title,
  width = 74,
}: {
  url?: string | null;
  title: string;
  width?: number;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const dimensions = { width, height: width * 1.5 };
  return url && /^https?:\/\//i.test(url) && failedUrl !== url ? (
    <Image
      source={{ uri: url }}
      style={[styles.cover, dimensions]}
      resizeMode="cover"
      accessibilityLabel={`Ảnh bìa ${title}`}
      onError={() => setFailedUrl(url)}
    />
  ) : (
    <View style={[styles.cover, styles.fallback, dimensions]} accessibilityLabel="Chưa có ảnh bìa">
      <BookOpen color={colors.primary} size={30} />
    </View>
  );
}
const styles = StyleSheet.create({
  cover: { borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
