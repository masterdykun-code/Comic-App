import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Mail, ShieldCheck } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ErrorState } from '../../components/States';
import { useAuth } from '../../hooks/use-auth';
import { colors, radius } from '../../lib/theme';
import { safeError } from '../../lib/errors';
import { Action, ui } from '../stories/ui';
import { passwordRecoveryApi, recoveryEmailInput, recoveryResetInput } from './password-recovery';

export default function ForgotPasswordScreen() {
  const auth = useAuth(),
    router = useRouter();
  const [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [sent, setSent] = useState(false),
    [done, setDone] = useState(false),
    [show, setShow] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<'request' | 'reset' | null>(null),
    [cooldown, setCooldown] = useState(0);
  const lock = useRef(false),
    focused = useRef(true),
    request = useRef<AbortController | null>(null);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        request.current?.abort();
        setCode('');
        setPassword('');
        setConfirm('');
        setShow(false);
      };
    }, []),
  );
  const counting = cooldown > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [counting]);
  async function submit(kind: 'request' | 'reset') {
    if (lock.current || (kind === 'request' && cooldown > 0)) return;
    const parsed =
      kind === 'request'
        ? recoveryEmailInput.safeParse({ email })
        : recoveryResetInput.safeParse({
            email,
            code,
            newPassword: password,
            confirmPassword: confirm,
          });
    if (!parsed.success) {
      const issue = parsed.error.issues[0],
        field = issue.path[0];
      setError(
        field === 'email'
          ? 'Địa chỉ email chưa hợp lệ.'
          : field === 'code'
            ? 'Mã xác minh cần đúng 6 chữ số.'
            : issue.code === 'custom'
              ? issue.message
              : 'Mật khẩu cần từ 8 đến 128 ký tự.',
      );
      return;
    }
    lock.current = true;
    setBusy(kind);
    setError('');
    const controller = new AbortController();
    request.current = controller;
    try {
      if (kind === 'request') {
        await passwordRecoveryApi.request(email, controller.signal);
        if (focused.current && !controller.signal.aborted) {
          setSent(true);
          setCooldown(60);
          setCode('');
          setPassword('');
          setConfirm('');
        }
      } else {
        await passwordRecoveryApi.reset(
          { email, code, newPassword: password, confirmPassword: confirm },
          controller.signal,
        );
        if (focused.current && !controller.signal.aborted) setDone(true);
      }
    } catch (failure) {
      if (focused.current && !controller.signal.aborted) setError(safeError(failure).message);
    } finally {
      lock.current = false;
      request.current = null;
      if (focused.current) {
        setBusy(null);
        setCode('');
        setPassword('');
        setConfirm('');
        setShow(false);
      }
    }
  }
  if (auth.status === 'authenticated') return <Redirect href="/profile" />;
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScreenContainer>
        <AppHeader
          title={done ? 'Mật khẩu đã được đặt lại' : 'Quên mật khẩu'}
          subtitle="TRỞ LẠI VỚI NHỮNG CÂU CHUYỆN"
        />
        <View style={styles.card}>
          {done ? (
            <ShieldCheck color={colors.primary} size={32} />
          ) : (
            <Mail color={colors.primary} size={32} />
          )}
          {done ? (
            <>
              <Text accessibilityRole="alert" style={ui.heading}>
                Đặt lại mật khẩu thành công
              </Text>
              <Text style={ui.body}>
                Các phiên đăng nhập cũ đã được thu hồi. Bạn có thể đăng nhập bằng mật khẩu mới.
              </Text>
              <Action
                primary
                label="Đăng nhập bằng mật khẩu mới"
                onPress={() => router.replace('/login')}
              />
            </>
          ) : (
            <>
              <Text style={ui.heading}>
                {sent ? 'Kiểm tra hộp thư của bạn' : 'Nhận mã xác minh qua email'}
              </Text>
              <Text style={ui.body}>
                {sent
                  ? 'Nếu tài khoản đủ điều kiện, bạn sẽ nhận mã 6 chữ số. Kiểm tra cả thư rác. Mã có hiệu lực 10 phút; chỉ dùng mã mới nhất.'
                  : 'Nhập email đã đăng ký để nhận hướng dẫn đặt lại mật khẩu. Mật khẩu chưa thay đổi khi bạn yêu cầu mã.'}
              </Text>
              <Text style={styles.label}>Email</Text>
              <TextInput
                accessibilityLabel="Email khôi phục"
                value={email}
                onChangeText={setEmail}
                editable={!busy && !sent}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                maxLength={254}
                style={styles.input}
              />
              {sent && (
                <>
                  <Text style={styles.label}>Mã xác minh</Text>
                  <TextInput
                    accessibilityLabel="Mã xác minh"
                    value={code}
                    onChangeText={setCode}
                    editable={!busy}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    maxLength={6}
                    style={[styles.input, { letterSpacing: 5 }]}
                  />
                  {(
                    [
                      ['Mật khẩu mới', password, setPassword],
                      ['Xác nhận mật khẩu mới', confirm, setConfirm],
                    ] as const
                  ).map(([label, value, change]) => (
                    <View key={label} style={{ gap: 10 }}>
                      <Text style={styles.label}>{label}</Text>
                      <TextInput
                        accessibilityLabel={label}
                        value={value}
                        onChangeText={change}
                        editable={!busy}
                        secureTextEntry={!show}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="new-password"
                        textContentType="newPassword"
                        maxLength={129}
                        style={styles.input}
                      />
                    </View>
                  ))}
                  <Text style={ui.caption}>
                    Mật khẩu mới cần 8–128 ký tự. Sau khi đặt lại, mọi thiết bị cần đăng nhập lại.
                  </Text>
                  <Action
                    label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    disabled={!!busy}
                    onPress={() => setShow(!show)}
                  />
                </>
              )}
              {!!error && <ErrorState message={error} />}
              <Action
                primary
                label={busy ? 'Đang xử lý…' : sent ? 'Đặt lại mật khẩu' : 'Gửi mã xác minh'}
                disabled={!!busy}
                onPress={() => {
                  void submit(sent ? 'reset' : 'request');
                }}
              />
              {sent && (
                <>
                  <Action
                    label={cooldown ? `Gửi lại mã sau ${cooldown}s` : 'Gửi lại mã'}
                    disabled={!!busy || cooldown > 0}
                    onPress={() => {
                      void submit('request');
                    }}
                  />
                  <Action
                    label="Dùng email khác"
                    disabled={!!busy}
                    onPress={() => {
                      setSent(false);
                      setCooldown(0);
                      setCode('');
                      setPassword('');
                      setConfirm('');
                      setError('');
                    }}
                  />
                </>
              )}
            </>
          )}
        </View>
        {!done && (
          <Link href="/login" style={styles.link}>
            Quay lại đăng nhập
          </Link>
        )}
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderColor: colors.border,
    borderWidth: 1,
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
  link: { color: colors.primary, fontSize: 15, paddingVertical: 14, minHeight: 48 },
});
