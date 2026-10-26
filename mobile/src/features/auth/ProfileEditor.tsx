import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authSession } from '../../services/runtime';
import { ApiError, safeError } from '../../lib/errors';
import { ErrorState, LoadingState } from '../../components/States';
import { usePrivateScope } from '../library/session';
import { feedbackApi, profileInput } from '../feedback/api';
import { Field, useFeedbackAction } from '../feedback/shared';
import { Action, ui } from '../stories/ui';
import type { AuthUser } from '../../types/auth';
export function ProfileEditor({ onClose }: { onClose: () => void }) {
  const scope = usePrivateScope();
  const current = useQuery({
    queryKey: [...scope.prefix, 'profile'],
    enabled: !!scope.userId,
    queryFn: ({ signal }) => scope.run((owned) => feedbackApi.me(owned), signal),
    staleTime: 0,
  });
  if (current.isPending) return <LoadingState label="Đang tải hồ sơ hiện tại…" />;
  if (current.error)
    return (
      <ErrorState
        message={safeError(current.error).message}
        onRetry={() => {
          void current.refetch();
        }}
      />
    );
  if (!current.data || current.data.id !== scope.userId)
    return <ErrorState message="Hồ sơ không thuộc phiên hiện tại." />;
  return <ProfileForm key={current.data.updatedAt} user={current.data} onClose={onClose} />;
}
function ProfileForm({ user, onClose }: { user: AuthUser; onClose: () => void }) {
  const client = useQueryClient();
  const [name, setName] = useState(user.displayName);
  const [avatar, setAvatar] = useState(user.avatarUrl ?? '');
  const action = useFeedbackAction();
  return (
    <View style={ui.group}>
      <Text style={ui.heading}>Chỉnh sửa hồ sơ</Text>
      <Field
        label="Tên hiển thị"
        value={name}
        onChange={setName}
        maxLength={200}
        disabled={action.busy}
        multiline={false}
      />
      <Field
        label="URL ảnh đại diện"
        value={avatar}
        onChange={setAvatar}
        maxLength={4096}
        disabled={action.busy}
        multiline={false}
      />
      <Text style={ui.caption}>
        URL HTTP/HTTPS tối đa 2.048 ký tự. Để trống để gỡ ảnh đại diện.
      </Text>
      <Action
        label="Lưu hồ sơ"
        primary
        disabled={action.busy}
        onPress={() => {
          const input = profileInput.safeParse({
            displayName: name,
            avatarUrl: avatar === '' ? null : avatar,
          });
          if (!input.success) {
            action.setError(
              'Tên hiển thị cần 1–100 ký tự. Ảnh đại diện cần URL HTTP/HTTPS hợp lệ, tối đa 2.048 ký tự.',
            );
            return;
          }
          void action.run(async (signal) => {
            const updated = await feedbackApi.updateProfile(input.data, signal);
            if (updated.id !== user.id || updated.username !== user.username)
              throw new ApiError(502, 'Hồ sơ phản hồi không khớp tài khoản hiện tại.');
            if (action.scope.active()) {
              authSession.store.setState({ user: updated });
              client.setQueryData([...action.scope.prefix, 'profile'], updated);
              void client.invalidateQueries({ queryKey: ['public', 'feedback'] });
            }
          }, onClose);
        }}
      />
      <Action label="Hủy sửa hồ sơ" disabled={action.busy} onPress={onClose} />
      {action.error && <ErrorState message={action.error} />}
    </View>
  );
}
