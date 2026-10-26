import { Link, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Search } from 'lucide-react-native';
import { StoryCard } from '../../components/StoryCard';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { safeError } from '../../lib/errors';
import { colors, radius, typography } from '../../lib/theme';
import type { Story } from './api';

export function Action({
  label,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[ui.action, primary && ui.primary, disabled && ui.disabled]}
    >
      <Text style={[ui.actionText, primary && ui.primaryText]}>{label}</Text>
    </Pressable>
  );
}
export function SearchLink() {
  return (
    <Link href="/search" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tìm kiếm truyện"
        style={ui.searchLink}
      >
        <Search size={20} color={colors.primary} />
        <Text style={ui.actionText}>Tìm một câu chuyện…</Text>
      </Pressable>
    </Link>
  );
}
export function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={ui.group}>
      <Text style={ui.caption}>{label}</Text>
      <View style={ui.wrap}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${option.label}`}
            accessibilityState={{ selected: option.value === value }}
            onPress={() => {
              if (option.value !== value) onChange(option.value);
            }}
            style={[ui.chip, option.value === value && ui.selected]}
          >
            <Text style={[ui.chipText, option.value === value && ui.selectedText]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export function StoryResults({
  stories,
  pending,
  error,
  retry,
  emptyTitle = 'Chưa có truyện phù hợp',
}: {
  stories: Story[];
  pending: boolean;
  error: unknown;
  retry: () => void;
  emptyTitle?: string;
}) {
  const router = useRouter();
  if (pending) return <LoadingState label="Đang tải truyện…" />;
  return (
    <View style={ui.group}>
      {error ? <ErrorState message={safeError(error).message} onRetry={retry} /> : null}
      {!error && stories.length === 0 && (
        <EmptyState
          title={emptyTitle}
          message="Hãy thử bộ lọc khác hoặc quay lại khi có nội dung mới được xuất bản."
        />
      )}
      {stories.map((story) => (
        <StoryCard
          key={story.id}
          story={story}
          onPress={() => router.push({ pathname: '/story/[id]', params: { id: story.id } })}
        />
      ))}
    </View>
  );
}
export const typeOptions = [
  { value: '', label: 'Tất cả' },
  { value: 'NOVEL', label: 'Tiểu thuyết' },
  { value: 'COMIC', label: 'Truyện tranh' },
] as const;
export const ui = StyleSheet.create({
  group: { gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heading: { ...typography.heading, color: colors.ink },
  body: { ...typography.body, color: colors.muted },
  caption: { ...typography.small, color: colors.muted, fontWeight: '600' },
  action: {
    minHeight: 48,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.primary },
  disabled: { opacity: 0.45 },
  actionText: { ...typography.body, color: colors.primary, fontWeight: '600' },
  primaryText: { color: colors.surface },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
  },
  selected: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { ...typography.small, color: colors.ink },
  selectedText: { color: colors.surface },
  searchLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    padding: 16,
  },
});
