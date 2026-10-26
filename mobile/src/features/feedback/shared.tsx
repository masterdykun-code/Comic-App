import { useRef, useState } from 'react';
import { Image, Text, TextInput, View, StyleSheet, Pressable } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { safeError } from '../../lib/errors';
import { colors } from '../../lib/theme';
import { usePrivateScope } from '../library/session';
import { ui } from '../stories/ui';
export function useFeedbackAction(storyId?: string) {
  const scope = usePrivateScope();
  const client = useQueryClient();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(
    work: (signal: AbortSignal) => Promise<unknown>,
    done?: () => void,
    deletingComment = false,
  ) {
    if (lock.current || !scope.active()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await scope.run(work);
      if (scope.active()) done?.();
    } catch (e) {
      if (scope.active()) {
        const err = safeError(e);
        setError(
          err.status === 409 && deletingComment
            ? 'Bình luận có thể có phản hồi (kể cả phản hồi ẩn), hoặc đã thay đổi. Hãy tải lại; không thể xóa khi còn phản hồi.'
            : err.message,
        );
      }
    } finally {
      if (scope.active() && storyId)
        await Promise.all([
          client.invalidateQueries({ queryKey: ['public', 'feedback', storyId] }),
          client.invalidateQueries({ queryKey: [...scope.prefix, 'rating', storyId] }),
        ]);
      lock.current = false;
      setBusy(false);
    }
  }
  return { scope, busy, error, setError, run };
}
export function Field({
  label,
  value,
  onChange,
  maxLength,
  disabled = false,
  multiline = true,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  maxLength: number;
  disabled?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={ui.group}>
      <Text style={ui.caption}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        maxLength={maxLength}
        editable={!disabled}
        multiline={multiline}
        textAlignVertical="top"
        autoCapitalize={multiline ? 'sentences' : 'none'}
        style={[styles.field, multiline && { minHeight: 96 }]}
      />
    </View>
  );
}
export function Author({
  user,
}: {
  user: { displayName: string; username: string; avatarUrl: string | null };
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.author}>
      {user.avatarUrl && /^https?:\/\//.test(user.avatarUrl) && !failed ? (
        <Image
          accessibilityLabel={`Ảnh của ${user.displayName}`}
          source={{ uri: user.avatarUrl }}
          style={styles.avatar}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={ui.body}>{user.displayName}</Text>
        <Text style={ui.caption}>@{user.username}</Text>
      </View>
    </View>
  );
}
export function Stars({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityLabel={`${n} sao`}
          accessibilityState={{ checked: n === value, disabled }}
          disabled={disabled}
          key={n}
          onPress={() => onChange(n)}
          style={styles.star}
        >
          <Text style={{ fontSize: 28, color: n <= value ? colors.gold : colors.muted }}>
            {n <= value ? '★' : '☆'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export const feedbackStyles = StyleSheet.create({
  card: {
    padding: 16,
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reply: {
    marginLeft: 16,
    borderLeftWidth: 2,
    borderLeftColor: colors.primarySoft,
    paddingLeft: 12,
    gap: 16,
  },
});
const styles = StyleSheet.create({
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    color: colors.ink,
    backgroundColor: colors.surface,
    fontSize: 15,
    lineHeight: 24,
  },
  author: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  star: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  stars: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
});
