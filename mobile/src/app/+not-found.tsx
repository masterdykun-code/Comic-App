import { Link } from 'expo-router';
import { ScreenContainer } from '../components/ScreenContainer';
import { ErrorState } from '../components/States';
export default function NotFoundScreen() {
  return (
    <ScreenContainer>
      <ErrorState message="Màn hình này không tồn tại." />
      <Link href="/">Về trang chủ</Link>
    </ScreenContainer>
  );
}
