import type { Href } from 'expo-router';
import { isUuid } from '../stories/api';
export function safeReturnPath(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim() !== raw) return '/library';
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || /[%\\#]/.test(raw))
    return '/library';
  if (
    [
      '/',
      '/library',
      '/history',
      '/bookmarks',
      '/wallet',
      '/profile',
      '/account',
      '/explore',
      '/search',
    ].includes(raw)
  )
    return raw;
  const story = /^\/story\/([^/?]+)$/.exec(raw);
  if (story && isUuid(story[1])) return `/story/${story[1]}`;
  const feedback = /^\/feedback\/([^/?]+)$/.exec(raw);
  if (feedback && isUuid(feedback[1])) return `/feedback/${feedback[1]}`;
  const reader = /^\/reader\/([^/?]+)\?storyId=([^&]+)$/.exec(raw);
  if (reader && isUuid(reader[1]) && isUuid(reader[2]))
    return `/reader/${reader[1]}?storyId=${reader[2]}`;
  return '/library';
}
export const returnHref = (raw: unknown): Href => safeReturnPath(raw) as Href;
