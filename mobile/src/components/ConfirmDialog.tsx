import { Modal, StyleSheet, Text, View } from 'react-native';
import { Action, ui } from '../features/stories/ui';
import { colors, radius } from '../lib/theme';
export function ConfirmDialog({
  visible,
  title,
  message,
  onCancel,
  onConfirm,
  busy = false,
}: {
  visible: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onCancel();
      }}
    >
      <View style={styles.overlay}>
        <View accessibilityViewIsModal style={styles.panel}>
          <Text accessibilityRole="header" style={ui.heading}>
            {title}
          </Text>
          <Text style={ui.body}>{message}</Text>
          <Action
            label="Hủy"
            disabled={busy || !visible}
            onPress={() => {
              if (visible && !busy) onCancel();
            }}
          />
          <Action
            label={busy ? 'Đang xử lý…' : 'Xác nhận'}
            primary
            disabled={busy || !visible}
            onPress={() => {
              if (visible && !busy) onConfirm();
            }}
          />
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 24 },
  panel: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 24,
    gap: 16,
  },
});
