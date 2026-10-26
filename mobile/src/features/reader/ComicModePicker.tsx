import { Pressable, Text, View } from 'react-native';
import { BookOpen, Check, List } from 'lucide-react-native';
import type { ComicMode } from '../../stores/comic-settings';
import type { ReaderTheme } from './theme';

export function ComicModePicker({
  mode,
  onChange,
  theme,
  notice,
}: {
  mode: ComicMode;
  onChange: (mode: ComicMode) => void;
  theme: ReaderTheme;
  notice: string | null;
}) {
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>
        Chế độ đọc truyện tranh
      </Text>
      {(
        [
          {
            mode: 'vertical',
            label: 'Cuộn dọc',
            detail: 'Đọc liền mạch, vuốt để xem các trang.',
            Icon: List,
          },
          {
            mode: 'paged',
            label: 'Từng trang',
            detail: 'Tập trung một trang, chuyển bằng nút trước / sau.',
            Icon: BookOpen,
          },
        ] as const
      ).map((option) => (
        <Pressable
          key={option.mode}
          accessibilityRole="button"
          accessibilityLabel={option.label}
          accessibilityState={{ selected: mode === option.mode }}
          onPress={() => onChange(option.mode)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            padding: 18,
            minHeight: 80,
            borderWidth: mode === option.mode ? 2 : 1,
            borderRadius: 18,
            borderColor: mode === option.mode ? theme.text : theme.border,
            backgroundColor: theme.background,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <option.Icon size={24} color={theme.text} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
              {option.label}
            </Text>
            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
              {option.detail}
            </Text>
          </View>
          {mode === option.mode && <Check size={18} color={theme.text} />}
        </Pressable>
      ))}
      <Text
        accessibilityRole={notice ? 'alert' : undefined}
        style={{ color: theme.muted, fontSize: 12, lineHeight: 19 }}
      >
        {notice ??
          'Tự động lưu chế độ trên thiết bị. Nhấn biểu tượng phóng to trên ảnh để xem chi tiết.'}
      </Text>
    </View>
  );
}
