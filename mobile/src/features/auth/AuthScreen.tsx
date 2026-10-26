import { useCallback, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppHeader } from '../../components/AppHeader';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ErrorState } from '../../components/States';
import { useAuth } from '../../hooks/use-auth';
import { authSession, authTransport } from '../../services/runtime';
import { ApiError, safeError } from '../../lib/errors';
import { colors, radius, typography } from '../../lib/theme';
import { Action, ui } from '../stories/ui';
import { clearPrivateCache } from '../library/session';
import { fieldErrors, loginSchema, registerSchema } from './validation';
import { returnHref, safeReturnPath } from './navigation';

export default function AuthScreen({ register = false }: { register?: boolean }) {
  const auth = useAuth();
  const router = useRouter();
  const client = useQueryClient();
  const params = useLocalSearchParams<{ next?: string; registered?: string }>();
  const next = safeReturnPath(params.next);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const focused = useRef(true);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        setPassword('');
        setConfirm('');
        setShow(false);
      };
    }, [setPassword, setConfirm, setShow]),
  );
  async function submit() {
    if (lock.current || auth.status === 'signing-in') return;
    const parsed = register
      ? registerSchema.safeParse({ username, email, password, confirmPassword })
      : loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    lock.current = true;
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      if (register) {
        const values = registerSchema.parse({ username, email, password, confirmPassword });
        const account = await authTransport.register({
          username: values.username,
          email: values.email,
          password: values.password,
        });
        if (account.role !== 'USER' || account.status !== 'ACTIVE')
          throw new ApiError(502, 'Phản hồi đăng ký chưa hợp lệ.');
        if (focused.current)
          router.replace({ pathname: '/login', params: { next, registered: '1' } });
      } else {
        await clearPrivateCache(client);
        if (!focused.current) return;
        await authSession.login({ email: parsed.data.email, password: parsed.data.password });
        if (focused.current) router.replace(returnHref(next));
      }
    } catch (failure) {
      const safe = safeError(failure);
      if (focused.current)
        setError(
          register && safe.status === 409
            ? 'Email hoặc username đã được sử dụng.'
            : !register && safe.status === 401
              ? 'Email hoặc mật khẩu chưa đúng, hoặc phiên không hợp lệ.'
              : safe.message,
        );
    } finally {
      lock.current = false;
      setPassword('');
      setConfirm('');
      setShow(false);
      setBusy(false);
    }
  }
  if (auth.status === 'authenticated' && auth.user?.status === 'ACTIVE' && !busy)
    return <Redirect href={returnHref(next)} />;
  const disabled = busy || auth.status === 'signing-in';
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScreenContainer>
        <AppHeader
          title={register ? 'Tạo tài khoản độc giả' : 'Chào bạn trở lại'}
          subtitle="KHÔNG GIAN RIÊNG CHO NHỮNG CÂU CHUYỆN"
        />
        {!register && params.registered === '1' && (
          <Text accessibilityRole="alert" style={ui.body}>
            Đăng ký thành công. Hãy đăng nhập để tiếp tục.
          </Text>
        )}
        {!error && auth.notice === 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' ? (
          <Text accessibilityRole="alert" style={[ui.body, { color: colors.primary }]}>
            {auth.notice}
          </Text>
        ) : error || auth.notice ? (
          <ErrorState message={error ?? auth.notice!} />
        ) : null}
        <View style={ui.group}>
          {register && (
            <>
              <Text style={styles.label}>Username</Text>
              <TextInput
                accessibilityLabel="Username"
                value={username}
                onChangeText={setUsername}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                maxLength={64}
                style={styles.input}
              />
              {errors.username && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {errors.username}
                </Text>
              )}
            </>
          )}
          <Text style={styles.label}>Email</Text>
          <TextInput
            accessibilityLabel="Email"
            value={email}
            onChangeText={setEmail}
            editable={!disabled}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            maxLength={254}
            style={styles.input}
          />
          {errors.email && (
            <Text accessibilityRole="alert" style={styles.error}>
              {errors.email}
            </Text>
          )}
          <Text style={styles.label}>Mật khẩu</Text>
          <TextInput
            accessibilityLabel="Mật khẩu"
            value={password}
            onChangeText={setPassword}
            editable={!disabled}
            secureTextEntry={!show}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={register ? 'new-password' : 'current-password'}
            textContentType={register ? 'newPassword' : 'password'}
            maxLength={256}
            style={styles.input}
          />
          {errors.password && (
            <Text accessibilityRole="alert" style={styles.error}>
              {errors.password}
            </Text>
          )}
          {register && (
            <>
              <Text style={styles.label}>Xác nhận mật khẩu</Text>
              <TextInput
                accessibilityLabel="Xác nhận mật khẩu"
                value={confirmPassword}
                onChangeText={setConfirm}
                editable={!disabled}
                secureTextEntry={!show}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                maxLength={256}
                style={styles.input}
              />
              {errors.confirmPassword && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {errors.confirmPassword}
                </Text>
              )}
            </>
          )}
          <Action
            label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            disabled={disabled}
            onPress={() => setShow((value) => !value)}
          />
          <Action
            label={disabled ? 'Đang xử lý…' : register ? 'Đăng ký' : 'Đăng nhập'}
            primary
            disabled={disabled}
            onPress={() => {
              void submit();
            }}
          />
        </View>
        {!disabled && (
          <View style={ui.group}>
            {!register && (
              <Link href="/forgot-password" style={styles.link}>
                Quên mật khẩu?
              </Link>
            )}
            <Link
              href={{ pathname: register ? '/login' : '/register', params: { next } }}
              style={styles.link}
            >
              {register ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký'}
            </Link>
            <Link href="/profile" style={styles.link}>
              Tiếp tục với vai trò khách
            </Link>
          </View>
        )}
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  label: { ...typography.body, color: colors.ink, fontWeight: '600' },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.ink,
    borderRadius: radius.sm,
    padding: 14,
    minHeight: 54,
  },
  error: { ...typography.small, color: colors.danger },
  link: { color: colors.primary, fontSize: 15, lineHeight: 24, paddingVertical: 14, minHeight: 48 },
});
