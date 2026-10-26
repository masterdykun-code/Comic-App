import type { Position } from './api';
export interface TextBlock {
  start: number;
  text: string;
}
// UTF-16 offsets match JavaScript String.length in the Backend. Never use scroll pixels.
export function textBlocks(content: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + 800, content.length);
    const newline = content.lastIndexOf('\n', end - 1);
    if (end < content.length && newline > start + 200) end = newline + 1;
    else if (end < content.length) {
      const space = content.lastIndexOf(' ', end);
      if (space > start + 400) end = space + 1;
      // Do not split surrogate pairs (emoji and non-BMP characters).
      if (end > start && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
    }
    blocks.push({ start, text: content.slice(start, end) });
    start = end;
  }
  return blocks;
}
export function percent(offset: number, total: number) {
  return total > 0 ? Math.round(Math.max(0, Math.min(1, offset / total)) * 10_000) / 100 : 0;
}
export function novelPosition(chapterId: string, offset: number, length: number): Position {
  const textOffset = Math.max(0, Math.min(length, Math.floor(offset)));
  return {
    chapterId,
    textOffset,
    pageNumber: null,
    scrollOffset: null,
    progressPercent: percent(textOffset, length),
  };
}
export function comicPosition(
  chapterId: string,
  pageNumber: number,
  index: number,
  count: number,
  atEnd = false,
): Position {
  return {
    chapterId,
    textOffset: null,
    pageNumber,
    scrollOffset: 0,
    progressPercent: atEnd ? 100 : percent(index, count),
  };
}
