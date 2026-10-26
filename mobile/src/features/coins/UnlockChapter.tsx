import { useRef, useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { LockKeyhole } from 'lucide-react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePrivateScope } from '../library/session';
import { coinsApi } from './api';
import { Action, ui } from '../stories/ui';
import { colors, radius } from '../../lib/theme';
import { safeError } from '../../lib/errors';
import { ErrorState, LoadingState } from '../../components/States';
import { ConfirmDialog } from '../../components/ConfirmDialog';
export function UnlockChapter({
  chapterId,
  storyId,
  onOpened,
}: {
  chapterId: string;
  storyId: string;
  onOpened: () => void;
}) {
  const scope = usePrivateScope(),
    cache = useQueryClient(),
    [quote, setQuote] = useState<number | null>(null),
    [error, setError] = useState(''),
    lock = useRef(false);
  const access = useQuery({
    queryKey: [...scope.prefix, 'chapter-access', chapterId],
    queryFn: ({ signal }) => coinsApi.access(chapterId, signal),
    staleTime: 0,
  });
  const wallet = useQuery({
    queryKey: [...scope.prefix, 'coins', 'wallet', 1],
    enabled: !!scope.userId,
    queryFn: ({ signal }) => scope.run((s) => coinsApi.wallet(1, s), signal),
  });
  const purchase = useMutation({
    mutationKey: [...scope.prefix, 'chapter-unlock', chapterId],
    retry: false,
    mutationFn: (price: number) => scope.run((signal) => coinsApi.unlock(chapterId, price, signal)),
    onSettled: async () => {
      if (scope.active())
        await Promise.all([
          cache.invalidateQueries({ queryKey: [...scope.prefix, 'coins'] }),
          access.refetch(),
        ]);
    },
  });
  async function unlock() {
    if (lock.current || !scope.active() || quote === null) return;
    lock.current = true;
    setError('');
    try {
      await purchase.mutateAsync(quote);
      if (scope.active()) {
        setQuote(null);
        onOpened();
      }
    } catch (e) {
      if (scope.active()) {
        setQuote(null);
        setError(
          `${safeError(e).message} Kiểm tra lại số dư và quyền mở chương trước khi thử tiếp.`,
        );
      }
    } finally {
      lock.current = false;
    }
  }
  const price = access.data?.coinPrice;
  return (
    <View style={{ padding: 24, gap: 18, backgroundColor: colors.background, flex: 1 }}>
      <View
        style={{
          alignItems: 'center',
          padding: 25,
          gap: 12,
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
        }}
      >
        <LockKeyhole size={42} color="#a9782f" />
        <Text style={ui.heading}>Chương VIP</Text>
        <Text style={ui.body}>
          Mở khóa một lần, đọc lại bất cứ khi nào chương còn được xuất bản.
        </Text>
      </View>
      {access.isPending ? (
        <LoadingState label="Đang kiểm tra chương…" />
      ) : access.error ? (
        <ErrorState
          message={safeError(access.error).message}
          onRetry={() => void access.refetch()}
        />
      ) : (
        <>
          <Text style={ui.heading}>{access.data?.title}</Text>
          <Text style={ui.body}>Giá mở khóa: {price} Coin</Text>
          {!scope.userId ? (
            <Link
              href={{
                pathname: '/login',
                params: { next: `/reader/${chapterId}?storyId=${storyId}` },
              }}
              style={ui.action}
            >
              Đăng nhập để mở khóa
            </Link>
          ) : (
            <>
              <Text style={ui.body}>Số dư: {wallet.data?.balance ?? '—'} Coin</Text>
              {wallet.error && (
                <ErrorState
                  message={safeError(wallet.error).message}
                  onRetry={() => void wallet.refetch()}
                />
              )}
              {!!error && <ErrorState message={error} />}
              {access.data?.canRead ? (
                <Action label="Đọc chương đã mở khóa" primary onPress={onOpened} />
              ) : (
                <Action
                  label={`Mở khóa với ${price} Coin`}
                  primary
                  disabled={
                    purchase.isPending ||
                    !wallet.data ||
                    wallet.isError ||
                    wallet.data.balance < (price ?? Infinity)
                  }
                  onPress={() => setQuote(price ?? null)}
                />
              )}
              {wallet.data && wallet.data.balance < (price ?? 0) && !access.data?.canRead && (
                <Text accessibilityRole="alert" style={ui.body}>
                  Bạn chưa đủ Coin. Điểm danh hoặc hoàn thành nhiệm vụ để nhận thêm.
                </Text>
              )}
              <Link href="/wallet" style={ui.action}>
                Mở ví Coin và nhiệm vụ
              </Link>
              <Action
                label="Kiểm tra lại quyền và số dư"
                disabled={purchase.isPending}
                onPress={() => {
                  void access.refetch();
                  void wallet.refetch();
                }}
              />
            </>
          )}
        </>
      )}
      <ConfirmDialog
        visible={quote !== null}
        title="Mở khóa chương VIP?"
        message={`Sử dụng ${quote ?? 0} Coin để mở khóa chương này? Chương đã mở khóa sẽ không bị tính phí lần nữa.`}
        busy={purchase.isPending}
        onCancel={() => setQuote(null)}
        onConfirm={() => void unlock()}
      />
    </View>
  );
}
