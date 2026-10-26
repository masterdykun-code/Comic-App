import { useRef, useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { Image, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { UserRound } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/use-auth';
import { authSession } from '../../services/runtime';
import { ScreenContainer } from '../../components/ScreenContainer';
import { AppHeader } from '../../components/AppHeader';
import { ErrorState } from '../../components/States';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { colors, radius } from '../../lib/theme';
import { Action, ui } from '../stories/ui';
import { clearPrivateCache } from '../library/session';
import { ProfileEditor } from './ProfileEditor';
import { ChangePasswordForm } from './ChangePasswordForm';
export default function ProfileScreen({ requireLogin = false }: { requireLogin?: boolean }) {
  const auth = useAuth();
  return (
    <ProfileContent
      key={`${auth.user?.id ?? 'guest'}:${authSession.generation()}`}
      requireLogin={requireLogin}
    />
  );
}
function ProfileContent({ requireLogin }: { requireLogin: boolean }) {
  const auth = useAuth();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const active = auth.status === 'authenticated' && auth.user?.status === 'ACTIVE';
  const lock = useRef(false);
  if (requireLogin && !active)
    return <Redirect href={{ pathname: '/login', params: { next: '/account' } }} />;
  async function logout() {
    if (lock.current) return;
    lock.current = true;
    const epoch = authSession.generation();
    setConfirm(false);
    setBusy(true);
    try {
      await clearPrivateCache(client);
      if (authSession.generation() === epoch) await authSession.logout();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScreenContainer>
        <AppHeader title={requireLogin ? 'Tài khoản độc giả' : 'Hồ sơ'} />
        {auth.notice &&
          (auth.notice === 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' ? (
            <Text accessibilityRole="alert" style={[ui.body, { color: colors.primary }]}>
              {auth.notice}
            </Text>
          ) : (
            <ErrorState message={auth.notice} />
          ))}
        {active && auth.user ? (
          <>
            <View style={styles.card}>
              <Avatar key={`${auth.user.id}:${auth.user.avatarUrl}`} url={auth.user.avatarUrl} />
              <Text style={ui.heading}>{auth.user.displayName}</Text>
              <Text style={ui.body}>@{auth.user.username}</Text>
              <Text style={ui.body}>{auth.user.email}</Text>
              <Text style={ui.caption}>Tài khoản {auth.user.role} · Không gian độc giả</Text>
              <Text style={ui.caption}>Trạng thái · Đang hoạt động</Text>
            </View>
            {editing ? (
              <ProfileEditor onClose={() => setEditing(false)} />
            ) : (
              <Action
                label="Chỉnh sửa hồ sơ"
                onPress={() => {
                  setChangingPassword(false);
                  setEditing(true);
                }}
              />
            )}
            {changingPassword ? (
              <ChangePasswordForm onClose={() => setChangingPassword(false)} />
            ) : (
              <Action
                label="Đổi mật khẩu"
                onPress={() => {
                  setEditing(false);
                  setChangingPassword(true);
                }}
              />
            )}
            <Link href="/wallet" style={styles.link}>
              Ví Coin · Điểm danh · Nhiệm vụ
            </Link>
            <Link href="/library" style={styles.link}>
              Mở giá sách
            </Link>
            <Link href="/history" style={styles.link}>
              Lịch sử đọc
            </Link>
            <Action
              label={busy ? 'Đang đăng xuất…' : 'Đăng xuất'}
              disabled={busy}
              onPress={() => setConfirm(true)}
            />
          </>
        ) : (
          <View style={ui.group}>
            <Text style={ui.heading}>Chào bạn đọc</Text>
            <Text style={ui.body}>
              Đọc với vai trò khách, hoặc đăng nhập để đồng bộ giá sách và vị trí đọc.
            </Text>
            <Link href={{ pathname: '/login', params: { next: '/profile' } }} style={styles.link}>
              Đăng nhập
            </Link>
            <Link
              href={{ pathname: '/register', params: { next: '/profile' } }}
              style={styles.link}
            >
              Đăng ký
            </Link>
          </View>
        )}
        <ConfirmDialog
          visible={active && confirm}
          title="Đăng xuất khỏi ứng dụng?"
          message="Giá sách, tiến độ và lịch sử trên máy chủ vẫn được giữ lại."
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            void logout();
          }}
        />
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}
function Avatar({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (url && /^https?:\/\//.test(url) && !failed)
    return (
      <Image
        source={{ uri: url }}
        accessibilityLabel="Ảnh đại diện"
        style={styles.avatar}
        onError={() => setFailed(true)}
      />
    );
  return (
    <View style={[styles.avatar, styles.fallback]}>
      <UserRound color={colors.primary} size={30} />
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    padding: 24,
    borderRadius: radius.lg,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  fallback: { backgroundColor: colors.primarySoft, justifyContent: 'center', alignItems: 'center' },
  link: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 24,
    paddingVertical: 14,
    minHeight: 48,
  },
});
