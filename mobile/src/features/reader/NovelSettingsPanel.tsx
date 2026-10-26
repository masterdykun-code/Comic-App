import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Minus, Plus, RotateCcw } from 'lucide-react-native';
import type { NovelSettings, ReaderFont } from '../../stores/reader-settings';
import { readerFontFamily } from './fonts';
import { readerThemes, type ReaderTheme, type ThemeName } from './theme';

export function NovelSettingsPanel({
  value,
  onChange,
  onReset,
  notice,
}: {
  value: NovelSettings;
  onChange: (patch: Partial<NovelSettings>) => void;
  onReset: () => void;
  notice: string | null;
}) {
  const theme = readerThemes[value.theme];
  const color = { color: theme.text };
  function choice(label: string, selected: boolean, action: () => void, font?: ReaderFont) {
    return (
      <Pressable
        key={label}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={action}
        style={({ pressed }) => [
          styles.choice,
          {
            borderColor: selected ? theme.text : theme.border,
            backgroundColor: selected ? theme.background : theme.panel,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text
          style={[
            color,
            styles.choiceText,
            { fontFamily: font ? readerFontFamily(font) : undefined },
          ]}
        >
          {label}
        </Text>
        {selected && <Check size={16} color={theme.text} />}
      </Pressable>
    );
  }
  return (
    <View style={styles.sections}>
      <View
        accessibilityLabel="Xem trước kiểu chữ"
        style={[styles.preview, { backgroundColor: theme.background, borderColor: theme.border }]}
      >
        <Text style={[styles.eyebrow, { color: theme.muted }]}>GÓC ĐỌC CỦA BẠN</Text>
        <Text
          style={[
            color,
            {
              fontFamily: readerFontFamily(value.font),
              fontSize: value.fontSize,
              lineHeight: Math.round(value.fontSize * value.lineSpacing),
            },
          ]}
        >
          {'Một trang sách mở ra,\nmột thế giới đang chờ đón.'}
        </Text>
      </View>
      <View style={styles.sections}>
        <View style={styles.row}>
          <Text style={[styles.heading, color]}>Cỡ chữ</Text>
          <Text accessibilityLiveRegion="polite" style={{ color: theme.muted }}>
            {value.fontSize} px
          </Text>
        </View>
        <View style={styles.sizeControls}>
          <SizeButton
            label="Giảm cỡ chữ"
            disabled={value.fontSize <= 14}
            theme={theme}
            onPress={() => onChange({ fontSize: value.fontSize - 2 })}
            decrease
          />
          <Text style={[color, { fontSize: 26, fontWeight: '600' }]}>{value.fontSize}</Text>
          <SizeButton
            label="Tăng cỡ chữ"
            disabled={value.fontSize >= 30}
            theme={theme}
            onPress={() => onChange({ fontSize: value.fontSize + 2 })}
          />
        </View>
      </View>
      <View style={styles.group}>
        <Text style={[styles.heading, color]}>Font chữ</Text>
        <View style={styles.choices}>
          {(
            [
              { id: 'system', label: 'Mặc định' },
              { id: 'serif', label: 'Có chân' },
              { id: 'mono', label: 'Đơn cách' },
            ] as const
          ).map(({ id, label }) =>
            choice(label, value.font === id, () => onChange({ font: id }), id),
          )}
        </View>
      </View>
      <View style={styles.group}>
        <Text style={[styles.heading, color]}>Khoảng cách dòng</Text>
        <View style={styles.choices}>
          {[1.5, 1.8, 2.1].map((lineSpacing) =>
            choice(`Dòng ${lineSpacing}`, value.lineSpacing === lineSpacing, () =>
              onChange({ lineSpacing }),
            ),
          )}
        </View>
      </View>
      <View style={styles.group}>
        <Text style={[styles.heading, color]}>Màu nền</Text>
        <View style={styles.choices}>
          {(
            [
              { id: 'light', label: 'Nền sáng' },
              { id: 'sepia', label: 'Nền sepia' },
              { id: 'dark', label: 'Nền tối' },
            ] satisfies { id: ThemeName; label: string }[]
          ).map(({ id, label }) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: value.theme === id }}
              onPress={() => onChange({ theme: id })}
              style={[
                styles.swatch,
                {
                  backgroundColor: readerThemes[id].background,
                  borderColor: value.theme === id ? theme.text : theme.border,
                  borderWidth: value.theme === id ? 2 : 1,
                },
              ]}
            >
              <Text
                style={{
                  color: readerThemes[id].text,
                  fontSize: 22,
                  fontFamily: readerFontFamily(value.font),
                }}
              >
                Aa
              </Text>
              <Text style={{ color: readerThemes[id].text, fontSize: 13 }}>{label}</Text>
              {value.theme === id && <Check size={14} color={readerThemes[id].text} />}
            </Pressable>
          ))}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Khôi phục mặc định"
        onPress={onReset}
        style={styles.reset}
      >
        <RotateCcw size={16} color={theme.muted} />
        <Text style={{ color: theme.muted }}>Khôi phục mặc định</Text>
      </Pressable>
      <Text
        accessibilityRole={notice ? 'alert' : undefined}
        style={{ color: theme.muted, fontSize: 12, lineHeight: 19 }}
      >
        {notice ?? 'Tự động lưu trên thiết bị · Áp dụng cho mọi truyện chữ.'}
      </Text>
    </View>
  );
}
function SizeButton({
  label,
  disabled,
  onPress,
  theme,
  decrease = false,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  theme: ReaderTheme;
  decrease?: boolean;
}) {
  const Icon = decrease ? Minus : Plus;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.sizeButton,
        { backgroundColor: theme.panel, borderColor: theme.border, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      <Icon size={22} color={theme.text} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  sections: { gap: 20 },
  group: { gap: 12 },
  preview: { borderWidth: 1, borderRadius: 20, padding: 20, gap: 12 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.6 },
  heading: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sizeControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 20,
  },
  sizeButton: {
    width: 64,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    flexGrow: 1,
    flexDirection: 'row',
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { fontSize: 14 },
  swatch: {
    flex: 1,
    minHeight: 92,
    borderRadius: 16,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  reset: {
    minHeight: 48,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
