import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StoryCover } from './StoryCover';
import { colors, radius, typography } from '../lib/theme';
export interface StoryPreview {
  id: string;
  title: string;
  authorName: string;
  type: 'NOVEL' | 'COMIC';
  coverUrl?: string | null;
}
export function StoryCard({ story, onPress }: { story: StoryPreview; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Xem ${story.title}`}
      onPress={onPress}
      style={styles.card}
    >
      <StoryCover url={story.coverUrl} title={story.title} />
      <View style={styles.info}>
        <Text style={styles.badge}>{story.type === 'NOVEL' ? 'TIỂU THUYẾT' : 'TRUYỆN TRANH'}</Text>
        <Text numberOfLines={2} style={styles.title}>
          {story.title}
        </Text>
        <Text numberOfLines={1} style={styles.author}>
          {story.authorName}
        </Text>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    flexDirection: 'row',
    gap: 16,
  },
  info: { flex: 1, gap: 8, justifyContent: 'center' },
  badge: { fontSize: 10, color: colors.primary, fontWeight: '700' },
  title: { ...typography.heading, fontSize: 17, color: colors.ink },
  author: { ...typography.small, color: colors.muted },
});
