import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { LockKeyhole } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { authSession } from '../../services/runtime';
import { safeError } from '../../lib/errors';
import { colors, radius } from '../../lib/theme';
import { ErrorState } from '../../components/States';
import { clearPrivateCache, usePrivateScope } from '../library/session';
import { Action, ui } from '../stories/ui';
import { changePasswordInput, passwordApi } from './change-password';

export function ChangePasswordForm({ onClose }: { onClose: () => void }) {
  const scope = usePrivateScope(),
    client = useQueryClient();
  const [currentPassword, setCurrent] = useState(''),
    [newPassword, setNew] = useState(''),
    [confirmPassword, setConfirm] = useState(''),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    focused = useRef(true);
  const clear = useCallback(() => {
    setCurrent('');
    setNew('');
    setConfirm('');
    setShow(false);
  }, []);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        clear();
      };
    }, [clear]),
  );
  async function submit() {
    if (lock.current || !scope.active()) return;
    const parsed = changePasswordInput.safeParse({ currentPassword, newPassword, confirmPassword });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue.code === 'custom' ? issue.message : 'Mật khẩu cần từ 8 đến 128 ký tự.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await scope.run((signal) => passwordApi.change(parsed.data, signal));
      if (!scope.active()) return;
      clear();
      await clearPrivateCache(client);
      if (scope.active()) await authSession.passwordChanged(scope.epoch);
    } catch (failure) {
      if (focused.current && scope.active()) setError(safeError(failure).message);
    } finally {
      lock.current = false;
      if (focused.current) {
        clear();
        setBusy(false);
      }
    }
  }
  return (
    <View style={styles.card}>
      <LockKeyhole size={26} color={colors.primary} />
      <Text style={ui.heading}>Đổi mật khẩu</Text>
      <Text style={ui.body}>
        Mật khẩu mới cần 8–128 ký tự. Sau khi đổi, tất cả thiết bị sẽ cần đăng nhập lại.
      </Text>
      {(
        [
          ['Mật khẩu hiện tại', currentPassword, setCurrent, false],
          ['Mật khẩu mới', newPassword, setNew, true],
          ['Xác nhận mật khẩu mới', confirmPassword, setConfirm, true],
        ] as const
      ).map(([label, value, onChangeText, isNew]) => (
        <View key={label} style={{ gap: 8 }}>
          <Text style={styles.label}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            value={value}
            onChangeText={onChangeText}
            editable={!busy}
            secureTextEntry={!show}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={isNew ? 'new-password' : 'current-password'}
            textContentType={isNew ? 'newPassword' : 'password'}
            maxLength={129}
            style={styles.input}
          />
        </View>
      ))}
      <Action
        label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        disabled={busy}
        onPress={() => setShow(!show)}
      />
      {!!error && <ErrorState message={error} />}
      <Action
        primary
        label={busy ? 'Đang đổi mật khẩu…' : 'Lưu mật khẩu mới'}
        disabled={busy}
        onPress={() => {
          void submit();
        }}
      />
      <Action
        label="Hủy đổi mật khẩu"
        disabled={busy}
        onPress={() => {
          clear();
          onClose();
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 20,
    gap: 16,
  },
  label: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.ink,
  },
});
