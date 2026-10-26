import { Link, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { ScreenContainer } from '../../components/ScreenContainer';
import { AppHeader } from '../../components/AppHeader';
import { ErrorState } from '../../components/States';
import { isUuid } from '../stories/api';
import { ui } from '../stories/ui';
import { Ratings } from './Ratings';
import { Comments } from './Comments';
export default function FeedbackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenContainer>
        <AppHeader title="Góc bạn đọc" />
        <Link href={{ pathname: '/story/[id]', params: { id } }} style={ui.actionText}>
          ← Về truyện
        </Link>
        {isUuid(id) ? (
          <>
            <Ratings storyId={id} />
            <Comments storyId={id} />
          </>
        ) : (
          <ErrorState message="Liên kết truyện không hợp lệ." />
        )}
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}
