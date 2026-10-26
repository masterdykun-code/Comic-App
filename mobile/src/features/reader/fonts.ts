import { Platform } from 'react-native';
import type { ReaderFont } from '../../stores/reader-settings';

export function readerFontFamily(
  font: ReaderFont,
  platform: string = Platform.OS,
): string | undefined {
  if (font === 'system') return undefined;
  if (font === 'serif') return platform === 'ios' ? 'Georgia' : 'serif';
  return platform === 'ios' ? 'Menlo' : 'monospace';
}
