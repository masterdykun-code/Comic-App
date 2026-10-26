import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronRight, ShieldCheck, UserRound } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { ScreenContainer } from '../../components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { useAuth } from '../../hooks/use-auth';
import { apiBaseUrl } from '../../lib/config';
import { colors, radius, typography } from '../../lib/theme';

export function LibraryScreen() {
  const auth = useAuth();
  return (
    <ScreenContainer>
      <AppHeader title="Giá sách" subtitle="NHỮNG CÂU CHUYỆN BẠN MUỐN GIỮ LẠI" />
      <EmptyState
        title={auth.user ? 'Giá sách đang được chuẩn bị' : 'Giữ lại câu chuyện yêu thích'}
        message={
          auth.user
            ? 'Yêu thích, tiến độ và lịch sử đọc chưa được tải ở bước này.'
            : 'Bạn có thể khám phá ứng dụng với vai trò khách. Đăng nhập và đồng bộ giá sách sẽ có ở bước tiếp theo.'
        }
      />
      {!auth.user && (
        <Link href="/login" style={styles.link}>
          Tìm hiểu đăng nhập <ChevronRight size={14} />
        </Link>
      )}
    </ScreenContainer>
  );
}
export function ProfileScreen() {
  const auth = useAuth();
  return (
    <ScreenContainer>
      <AppHeader title="Hồ sơ" subtitle="KHÔNG GIAN RIÊNG CỦA NGƯỜI ĐỌC" />
      <View style={styles.profile}>
        <View style={styles.avatar}>
          <UserRound color={colors.primary} size={30} />
        </View>
        <Text style={styles.sectionTitle}>{auth.user?.displayName ?? 'Chào bạn đọc'}</Text>
        <Text style={styles.body}>
          {auth.user
            ? 'Bạn đang ở không gian dành cho độc giả.'
            : 'Bạn đang sử dụng ứng dụng với vai trò khách.'}
        </Text>
      </View>
      {auth.user ? (
        <Link href="/account" style={styles.link}>
          Thông tin tài khoản
        </Link>
      ) : (
        <View style={styles.row}>
          <Link href="/login" style={styles.link}>
            Đăng nhập
          </Link>
          <Link href="/register" style={styles.link}>
            Đăng ký
          </Link>
        </View>
      )}
      <View style={styles.notice}>
        <ShieldCheck size={22} color={colors.primary} />
        <Text style={styles.formatTitle}>Phiên riêng tư, trải nghiệm của bạn</Text>
        <Text style={styles.body}>
          Ứng dụng chỉ dành cho việc đọc. Quản lý và xuất bản nội dung được thực hiện ở Admin Web.
        </Text>
      </View>
      <Text style={styles.small}>
        {apiBaseUrl
          ? 'Đã cấu hình địa chỉ API · Chưa kiểm tra kết nối'
          : 'Chưa cấu hình địa chỉ API · Xem README để kết nối Backend'}
      </Text>
    </ScreenContainer>
  );
}
export function AuthPlaceholder({ register = false }: { register?: boolean }) {
  const auth = useAuth();
  return (
    <ScreenContainer>
      <AppHeader
        title={register ? 'Tạo tài khoản độc giả' : 'Đăng nhập'}
        subtitle="NỀN TẢNG PHIÊN ĐÃ SẴN SÀNG"
      />
      {auth.notice && <ErrorState message={auth.notice} />}
      <EmptyState
        title="Form sẽ có ở bước tiếp theo"
        message={
          register
            ? 'Backend hỗ trợ username, email và mật khẩu. Bước này chưa gửi yêu cầu đăng ký hoặc tạo tài khoản.'
            : 'Backend dùng email và mật khẩu. Giao diện này chưa gửi yêu cầu đăng nhập hoặc sử dụng tài khoản thật.'
        }
      />
      <Link href={register ? '/login' : '/register'} style={styles.link}>
        {register ? 'Về trang đăng nhập' : 'Tìm hiểu đăng ký'}
      </Link>
      <Link href="/profile" style={styles.link}>
        Tiếp tục với vai trò khách
      </Link>
    </ScreenContainer>
  );
}
export function ContentPlaceholder({ reader = false }: { reader?: boolean }) {
  const { id, storyId } = useLocalSearchParams<{ id: string; storyId?: string }>();
  const valid = typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
  const storyValid =
    !storyId ||
    (typeof storyId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(storyId));
  return (
    <ScreenContainer>
      <AppHeader title={reader ? 'Không gian đọc' : 'Chi tiết truyện'} />
      {valid && storyValid ? (
        <EmptyState
          title={reader ? 'Trình đọc đang được chuẩn bị' : 'Chưa tải thông tin truyện'}
          message={
            reader
              ? 'Nội dung NOVEL và các trang COMIC sẽ có ở bước Reader. Hiện không có nội dung mẫu hoặc tiến độ được lưu.'
              : 'Màn hình này đã có route riêng. Chưa gọi API lấy chi tiết hoặc hiển thị truyện giả.'
          }
        />
      ) : (
        <ErrorState message="Liên kết không hợp lệ. ID cần có định dạng UUID." />
      )}
      <Link href="/explore" style={styles.link}>
        Về Khám phá
      </Link>
    </ScreenContainer>
  );
}
export function AccountScreen() {
  const auth = useAuth();
  if (auth.status === 'restoring') return <LoadingState />;
  if (auth.status !== 'authenticated' || !auth.user || auth.user.status !== 'ACTIVE')
    return <Redirect href="/login" />;
  return (
    <ScreenContainer>
      <AppHeader title="Tài khoản độc giả" />
      <Text style={styles.sectionTitle}>{auth.user.displayName}</Text>
      <Text style={styles.body}>@{auth.user.username}</Text>
      <EmptyState
        title="Tùy chỉnh hồ sơ · Sắp có"
        message="Không có chức năng quản trị trong ứng dụng Mobile, kể cả khi đăng nhập bằng ADMIN."
      />
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  formatTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  small: { ...typography.small, color: colors.muted },
  body: { ...typography.body, color: colors.muted },
  sectionTitle: { ...typography.heading, color: colors.ink },
  link: {
    color: colors.primary,
    paddingVertical: 14,
    fontWeight: '600',
    fontSize: 15,
    minHeight: 48,
  },
  notice: { backgroundColor: colors.primarySoft, padding: 24, borderRadius: radius.md, gap: 12 },
  profile: {
    padding: 28,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 24,
  },
});
