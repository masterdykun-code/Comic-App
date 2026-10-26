import { useCallback, useRef, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Coins, Gift, CalendarCheck, ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/ScreenContainer';
import { AppHeader } from '../../components/AppHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { colors, radius } from '../../lib/theme';
import { safeError } from '../../lib/errors';
import { usePrivateScope } from '../library/session';
import { Action, ui } from '../stories/ui';
import { coinsApi } from './api';
export default function WalletScreen() {
  const scope = usePrivateScope();
  if (!scope.userId)
    return (
      <ScreenContainer>
        <AppHeader title="Ví Coin" />
        <EmptyState
          title="Tích Coin để khám phá chương VIP"
          message="Đăng nhập để điểm danh, nhận thưởng và mở khóa chương."
        />
        <Link href={{ pathname: '/login', params: { next: '/wallet' } }} style={ui.action}>
          Đăng nhập
        </Link>
      </ScreenContainer>
    );
  return <ActiveWallet key={`${scope.userId}:${scope.epoch}`} />;
}
function ActiveWallet() {
  const scope = usePrivateScope(),
    cache = useQueryClient(),
    [page, setPage] = useState(1),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const flight = useRef(false);
  const wallet = useQuery({
    queryKey: [...scope.prefix, 'coins', 'wallet', page],
    queryFn: ({ signal }) => scope.run((s) => coinsApi.wallet(page, s), signal),
  });
  const tasks = useQuery({
    queryKey: [...scope.prefix, 'coins', 'tasks'],
    queryFn: ({ signal }) => scope.run(coinsApi.tasks, signal),
  });
  const { userId, epoch } = scope;
  const refresh = useCallback(() => {
    void cache.invalidateQueries({ queryKey: ['private', userId, epoch, 'coins'] });
  }, [cache, userId, epoch]);
  useFocusEffect(refresh);
  const mutation = useMutation({
    mutationKey: [...scope.prefix, 'coin-claim'],
    retry: false,
    mutationFn: (kind: 'CHECK_IN' | 'READ_THREE' | 'FAVORITE') =>
      scope.run((signal) => coinsApi.claim(kind, signal)),
    onSettled: async () => {
      if (scope.active()) await cache.invalidateQueries({ queryKey: [...scope.prefix, 'coins'] });
    },
  });
  async function claim(kind: 'CHECK_IN' | 'READ_THREE' | 'FAVORITE') {
    if (flight.current || !scope.active()) return;
    flight.current = true;
    setError('');
    setNotice('');
    try {
      const r = await mutation.mutateAsync(kind);
      if (scope.active()) {
        setNotice(r.received ? `Đã nhận ${r.reward} Coin!` : 'Bạn đã nhận phần thưởng hôm nay.');
        setPage(1);
      }
    } catch (e) {
      if (scope.active())
        setError(`${safeError(e).message} Hãy làm mới để kiểm tra số dư trước khi thử lại.`);
    } finally {
      flight.current = false;
    }
  }
  return (
    <ScreenContainer>
      <AppHeader title="Ví Coin" />
      <View style={styles.hero}>
        <View style={styles.row}>
          <Coins color="#ffe0a0" size={28} />
          <Text style={styles.heroLabel}>COIN CỦA BẠN</Text>
        </View>
        <Text style={styles.balance}>
          {wallet.data ? wallet.data.balance.toLocaleString('vi-VN') : '—'}{' '}
          <Text style={{ fontSize: 18 }}>Coin</Text>
        </Text>
        <Text style={styles.heroFoot}>Tích lũy mỗi ngày · Mở khóa chương yêu thích</Text>
      </View>
      <Text style={ui.caption}>
        Coin dùng trong ứng dụng, không phải tiền và không hỗ trợ thanh toán.
      </Text>
      {!!notice && (
        <Text accessibilityRole="alert" style={styles.success}>
          {notice}
        </Text>
      )}
      {!!error && <ErrorState message={error} />}
      <Action
        label="Làm mới ví và nhiệm vụ"
        disabled={mutation.isPending || wallet.isFetching || tasks.isFetching}
        onPress={refresh}
      />
      {tasks.isPending ? (
        <LoadingState label="Đang tải nhiệm vụ…" />
      ) : tasks.error ? (
        <ErrorState message={safeError(tasks.error).message} onRetry={() => void tasks.refetch()} />
      ) : (
        tasks.data && (
          <>
            <View style={styles.card}>
              <View style={styles.row}>
                <CalendarCheck color={colors.primary} size={24} />
                <Text style={ui.heading}>Điểm danh hằng ngày</Text>
              </View>
              <Text style={ui.body}>
                Nhận 10 Coin mỗi ngày. Ngày {tasks.data.day} · giờ Việt Nam.
              </Text>
              <Action
                primary
                label={tasks.data.checkedIn ? 'Đã điểm danh hôm nay' : 'Điểm danh +10 Coin'}
                disabled={tasks.data.checkedIn || mutation.isPending}
                onPress={() => void claim('CHECK_IN')}
              />
            </View>
            <View style={styles.row}>
              <Gift color={colors.primary} size={24} />
              <Text style={ui.heading}>Nhiệm vụ hôm nay</Text>
            </View>
            {tasks.data.missions.map((m) => (
              <View style={styles.card} key={m.kind}>
                <Text style={ui.heading}>{m.title}</Text>
                <View style={styles.row}>
                  <Text style={[ui.caption, { flex: 1 }]}>
                    {m.progress}/{m.target} · Mỗi ngày một lần
                  </Text>
                  <Text style={styles.reward}>+{m.reward} Coin</Text>
                </View>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.bar,
                      { width: `${Math.min(100, (m.progress / Math.max(1, m.target)) * 100)}%` },
                    ]}
                  />
                </View>
                <Action
                  label={
                    m.claimed
                      ? 'Đã nhận thưởng'
                      : m.progress >= m.target
                        ? `Nhận ${m.reward} Coin`
                        : 'Đang thực hiện'
                  }
                  disabled={m.claimed || m.progress < m.target || mutation.isPending}
                  onPress={() => void claim(m.kind)}
                />
              </View>
            ))}
            <Text style={ui.caption}>
              Tiến độ đọc tính khi mở chương thành công và ghi lịch sử, không tính lặp lại cùng
              chương. Yêu thích tính khi thêm một truyện mới vào giá sách trong ngày.
            </Text>
          </>
        )
      )}
      <Text style={ui.heading}>Lịch sử Coin</Text>
      {wallet.isPending ? (
        <LoadingState label="Đang tải ví…" />
      ) : wallet.error ? (
        <ErrorState
          message={safeError(wallet.error).message}
          onRetry={() => void wallet.refetch()}
        />
      ) : (
        wallet.data && (
          <>
            {!wallet.data.transactions.length && (
              <EmptyState
                title="Chưa có giao dịch"
                message="Hãy điểm danh để nhận những Coin đầu tiên."
              />
            )}
            {wallet.data.transactions.map((t) => (
              <View style={styles.transaction} key={t.id}>
                {t.amount > 0 ? (
                  <ArrowDownLeft color={colors.primary} size={22} />
                ) : (
                  <ArrowUpRight color="#a56318" size={22} />
                )}
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={{ color: colors.ink, fontWeight: '600' }}>{t.description}</Text>
                  <Text style={ui.caption}>
                    {new Date(t.createdAt).toLocaleString('vi-VN')} · Số dư {t.balanceAfter}
                  </Text>
                </View>
                <Text style={[styles.reward, { color: t.amount > 0 ? colors.primary : '#a56318' }]}>
                  {t.amount > 0 ? '+' : ''}
                  {t.amount}
                </Text>
              </View>
            ))}
            <Text style={ui.caption}>
              Trang {page}/{Math.max(1, wallet.data.pagination.totalPages)}
            </Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Action
                  label="Trang trước"
                  disabled={page <= 1 || wallet.isFetching}
                  onPress={() => setPage((n) => n - 1)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Action
                  label="Trang sau"
                  disabled={page >= wallet.data.pagination.totalPages || wallet.isFetching}
                  onPress={() => setPage((n) => n + 1)}
                />
              </View>
            </View>
          </>
        )
      )}
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  hero: { backgroundColor: '#233e38', padding: 25, borderRadius: radius.lg, gap: 16 },
  heroLabel: { color: '#d4dfd8', fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  balance: { color: '#fff3ce', fontSize: 43, fontWeight: '800' },
  heroFoot: { color: '#cfdfd6', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 18,
    gap: 14,
  },
  reward: { fontWeight: '700', color: '#9b6114', fontSize: 15 },
  track: { height: 7, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  bar: { height: 7, backgroundColor: colors.primary },
  success: {
    color: colors.primary,
    padding: 14,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
  },
  transaction: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: radius.md,
  },
});
