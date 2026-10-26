import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { BookOpen, CircleAlert } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '../lib/theme';
export function LoadingState({ label = 'Đang chuẩn bị…' }: { label?: string }) {
  return (
    <View accessible style={styles.box} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.body}>{label}</Text>
    </View>
  );
}
export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.box}>
      <View style={styles.icon}>
        <BookOpen size={26} color={colors.primary} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.body}>{message}</Text>
    </View>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.box}>
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{ alignItems: 'center', gap: 12 }}
      >
        <CircleAlert color={colors.danger} />
        <Text style={styles.title}>Chưa thể tiếp tục</Text>
        <Text style={styles.body}>{message}</Text>
      </View>
      {onRetry && (
        <Pressable onPress={onRetry} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.retryText}>Thử lại</Text>
        </Pressable>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 12,
  },
  icon: { backgroundColor: colors.primarySoft, borderRadius: 18, padding: 15 },
  title: { ...typography.heading, fontSize: 17, color: colors.ink, textAlign: 'center' },
  body: { ...typography.body, color: colors.muted, textAlign: 'center' },
  retry: { padding: 12, minHeight: 48 },
  retryText: { color: colors.primary, fontWeight: '700' },
});
