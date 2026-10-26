import { StyleSheet, Text, View } from 'react-native';
import { BookOpen } from 'lucide-react-native';
import { colors, typography } from '../lib/theme';
export function AppHeader({
  title,
  subtitle = 'MỘT TRANG MỚI, MỘT THẾ GIỚI MỚI',
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.brand}>
        <BookOpen color={colors.primary} size={25} />
        <Text style={styles.brandText}>
          WebNovel <Text style={styles.reader}>Reader</Text>
        </Text>
      </View>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={typography.title}>
          {title}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { gap: 28 },
  brand: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  brandText: { fontSize: 17, fontWeight: '700', color: colors.ink },
  reader: { fontWeight: '400', color: colors.muted },
  heading: { gap: 8 },
  subtitle: { fontSize: 9, letterSpacing: 1.2, color: colors.muted, lineHeight: 17 },
});
