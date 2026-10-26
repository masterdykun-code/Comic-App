import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Cover } from '../src/features/stories/components';
import { api } from '../src/features/auth/runtime';
vi.mock('../src/features/auth/runtime', () => ({ api: { get: vi.fn() } }));
beforeEach(() => vi.mocked(api.get).mockReset());
it('loads private EPUB cover through the authenticated API, never the supplied external origin', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: new Blob(['image'], { type: 'image/png' }) });
  const url = 'http://untrusted.example/api/epub-covers/10000000-0000-4000-8000-000000000001';
  const { unmount } = render(<Cover url={url} title="Sách nháp" />);
  await waitFor(() =>
    expect(screen.getByAltText('Bìa Sách nháp')).toHaveAttribute('src', 'blob:synthetic-preview'),
  );
  expect(api.get).toHaveBeenCalledWith(
    '/epub-covers/10000000-0000-4000-8000-000000000001',
    expect.objectContaining({ responseType: 'blob' }),
  );
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-preview');
});
it('keeps the existing normal external image behavior', () => {
  render(<Cover url="https://images.example/cover.jpg" title="Sách" />);
  expect(screen.getByAltText('Bìa Sách')).toHaveAttribute(
    'src',
    'https://images.example/cover.jpg',
  );
  expect(api.get).not.toHaveBeenCalled();
});
