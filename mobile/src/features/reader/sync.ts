import { safeError } from '../../lib/errors';
import type { Position, ProgressSnapshot, createReaderApi } from './api';
type Transport = Pick<ReturnType<typeof createReaderApi>, 'progress' | 'save'>;
const key = (p: Position) =>
  JSON.stringify([p.chapterId, p.textOffset, p.pageNumber, p.scrollOffset, p.progressPercent]);
export interface SyncState {
  ready: boolean;
  paused: boolean;
  snapshot: ProgressSnapshot | null;
  notice: string | null;
}
export class ReadingSync {
  private state: SyncState = { ready: false, paused: false, snapshot: null, notice: null };
  private pending: Position | null = null;
  private last = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private stopped = false;
  private lastWrite = 0;
  private started = false;
  activate() {
    this.stopped = false;
  }
  constructor(
    private storyId: string,
    private transport: Transport,
    private allowed: () => boolean,
    private changed: (state: SyncState) => void,
  ) {}
  private update(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    if (!this.stopped && this.allowed()) this.changed(this.state);
  }
  async start() {
    if (!this.allowed() || this.started || this.stopped) return;
    this.started = true;
    try {
      const snapshot = await this.transport.progress(this.storyId);
      if (!this.allowed() || this.stopped) return;
      if (snapshot.data) this.last = key(snapshot.data);
      this.update({ ready: true, snapshot });
    } catch {
      this.update({
        paused: true,
        notice: 'Chưa tải được tiến độ. Bạn vẫn có thể đọc; đồng bộ đang tạm dừng.',
      });
    }
  }
  offer(position: Position) {
    if (!this.allowed() || this.stopped || !this.state.ready || this.state.paused) return;
    if (!this.running && key(position) === this.last) {
      this.pending = null;
      return;
    }
    this.pending = position;
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.stopped || !this.pending || this.running) return;
    this.timer = setTimeout(
      () => {
        void this.flush();
      },
      Math.max(1500, 5000 - (Date.now() - this.lastWrite)),
    );
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    if (!this.allowed() || !this.state.ready || this.state.paused || !this.pending)
      return Promise.resolve();
    const position = this.pending;
    this.pending = null;
    if (key(position) === this.last) return Promise.resolve();
    const work = async () => {
      this.lastWrite = Date.now();
      try {
        const snapshot = await this.transport.save(
          this.storyId,
          position,
          this.state.snapshot!.version,
        );
        if (!this.allowed()) return;
        this.last = key(position);
        this.update({ snapshot });
      } catch (error) {
        this.pending = null;
        const conflict = safeError(error).status === 409;
        this.update({
          paused: true,
          notice: conflict
            ? 'Tiến độ đã thay đổi ở nơi khác. Đã ngừng tự lưu để không ghi đè. Hãy mở lại Reader sau khi kiểm tra vị trí đã lưu.'
            : 'Chưa xác nhận lưu tiến độ. Đồng bộ đã tạm dừng; nội dung vẫn đọc được.',
        });
        if (conflict && this.allowed()) {
          try {
            const snapshot = await this.transport.progress(this.storyId);
            if (this.allowed()) this.update({ snapshot });
          } catch {
            /* Keep paused; never retry a mutation automatically. */
          }
        }
      }
    };
    this.running = work().finally(() => {
      this.running = null;
      if (!this.stopped) this.schedule();
    });
    return this.running;
  }
  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    return this.running ? this.running.then(() => this.flush()) : this.flush();
  }
}
