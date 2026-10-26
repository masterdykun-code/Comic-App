export const readerThemes = {
  light: {
    background: '#FAFCFB',
    text: '#243D37',
    muted: '#5D756C',
    panel: '#FFFFFF',
    border: '#DDE7E2',
  },
  sepia: {
    background: '#F4EBD9',
    text: '#4B3D2A',
    muted: '#7B6748',
    panel: '#FCF5E8',
    border: '#DBCFB7',
  },
  dark: {
    background: '#17231F',
    text: '#E3EBE5',
    muted: '#A1B7AA',
    panel: '#22332B',
    border: '#3D5145',
  },
};
export type ReaderTheme = typeof readerThemes.light;
export type ThemeName = keyof typeof readerThemes;
