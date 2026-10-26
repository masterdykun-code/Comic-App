import { useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Action, ui } from '../stories/ui';
import { ErrorState } from '../../components/States';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { safeError } from '../../lib/errors';
import { usePrivateScope } from './session';
import { useFavoriteChange, useFavoriteStatus } from './queries';
export function FavoriteButton({ storyId }: { storyId: string }) {
  const scope = usePrivateScope();
  return scope.userId ? (
    <ActiveFavorite key={`${scope.userId}:${scope.epoch}:${storyId}`} storyId={storyId} />
  ) : (
    <GuestFavorite storyId={storyId} />
  );
}
function GuestFavorite({ storyId }: { storyId: string }) {
  const router = useRouter();
  return (
    <Action
      label="Lưu vào giá sách"
      onPress={() => router.push({ pathname: '/login', params: { next: `/story/${storyId}` } })}
    />
  );
}
function ActiveFavorite({ storyId }: { storyId: string }) {
  const status = useFavoriteStatus(storyId);
  const mutation = useFavoriteChange();
  const [confirm, setConfirm] = useState(false);
  return (
    <View style={ui.group}>
      <Action
        label={
          !status.known
            ? 'Đang kiểm tra giá sách…'
            : mutation.isPending
              ? 'Đang cập nhật…'
              : status.found
                ? 'Bỏ khỏi giá sách'
                : 'Lưu vào giá sách'
        }
        disabled={!status.known || mutation.isPending}
        onPress={() => {
          if (status.found) setConfirm(true);
          else mutation.change(storyId, false);
        }}
      />
      {status.error && (
        <ErrorState
          message={safeError(status.error).message}
          onRetry={() => {
            void status.refetch();
          }}
        />
      )}
      {mutation.error && (
        <ErrorState
          message={
            safeError(mutation.error).status === 409
              ? 'Giá sách có thay đổi. Đã tải lại trạng thái; hãy kiểm tra trước khi thử lại.'
              : safeError(mutation.error).message
          }
        />
      )}
      <ConfirmDialog
        visible={confirm}
        title="Bỏ truyện khỏi giá sách?"
        message="Tiến độ và lịch sử đọc sẽ được giữ lại."
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          mutation.change(storyId, true);
        }}
      />
    </View>
  );
}
