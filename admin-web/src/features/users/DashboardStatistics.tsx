import { Link } from 'react-router';
import { BookOpen, BookText, Image, Layers, Users, Eye, RefreshCw, TrendingUp } from 'lucide-react';
import { useDashboard } from './queries';
import { Loading, QueryError } from '../stories/components';
import '../stories/stories.css';
import './users.css';
const number = (value: number) => new Intl.NumberFormat('vi-VN').format(value);
export function DashboardStatistics() {
  const result = useDashboard();
  if (result.isPending)
    return (
      <section className="panel">
        <Loading label="Đang tải thống kê…" />
      </section>
    );
  if (result.isError)
    return (
      <section className="panel">
        <QueryError error={result.error} retry={() => void result.refetch()} />
      </section>
    );
  const stats = result.data;
  const cards = [
    {
      label: 'Người dùng',
      value: stats.users.total,
      icon: Users,
      detail: `${number(stats.users.active)} hoạt động · ${number(stats.users.banned)} đã khóa`,
    },
    {
      label: 'Tổng truyện',
      value: stats.stories.total,
      icon: BookOpen,
      detail: `${number(stats.stories.published)} đã xuất bản`,
    },
    {
      label: 'Tiểu thuyết NOVEL',
      value: stats.stories.novels,
      icon: BookText,
      detail: 'Tất cả trạng thái',
    },
    {
      label: 'Truyện tranh COMIC',
      value: stats.stories.comics,
      icon: Image,
      detail: 'Tất cả trạng thái',
    },
    {
      label: 'Tổng số chương',
      value: stats.totalChapters,
      icon: Layers,
      detail: 'Bao gồm bản nháp',
    },
    {
      label: 'Lượt đọc đã ghi nhận',
      value: stats.readingEvents,
      icon: Eye,
      detail: 'Từ lịch sử đọc hiện có',
    },
  ];
  return (
    <section className="dashboard-statistics" aria-label="Thống kê thư viện">
      <div className="section-heading">
        <div>
          <span className="eyebrow">DỮ LIỆU THỰC TỪ THƯ VIỆN</span>
          <h2>Thống kê tổng quan</h2>
        </div>
        <button
          className="stories-button secondary"
          disabled={result.isFetching}
          onClick={() => void result.refetch()}
        >
          <RefreshCw size={16} /> Làm mới thống kê
        </button>
      </div>
      <div className="metric-grid">
        {cards.map(({ label, value, icon: Icon, detail }) => (
          <article className="panel metric-card" key={label}>
            <span className="heading-icon">
              <Icon size={21} />
            </span>
            <p>{label}</p>
            <strong>{number(value)}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </div>
      <p className="metric-note">
        Người dùng chỉ tính vai trò USER. Lượt đọc là số lần mở chương đã ghi nhận của người đăng
        nhập, không tính khách; giảm khi lịch sử bị xóa, không phải bộ đếm lượt xem tích lũy.
      </p>
      <div className="panel popular-panel">
        <div className="panel-heading">
          <span className="heading-icon">
            <TrendingUp size={21} />
          </span>
          <div>
            <h2>Truyện phổ biến</h2>
            <p>Top 10 theo lượt đọc đã ghi nhận · gồm mọi trạng thái</p>
          </div>
        </div>
        {!stats.popularStories.length ? (
          <div className="stories-empty">
            <BookOpen size={30} />
            <h3>Chưa có lịch sử đọc</h3>
            <p>Bảng xếp hạng xuất hiện khi có lượt đọc được ghi nhận.</p>
          </div>
        ) : (
          <ol className="popular-list">
            {stats.popularStories.map((story, index) => (
              <li key={story.id}>
                <span className="popular-rank">{index + 1}</span>
                <div className="popular-story">
                  <Link to={`/stories/${story.id}`}>{story.title}</Link>
                  <small>
                    {story.type} ·{' '}
                    {story.publishStatus === 'PUBLISHED' ? 'Đã xuất bản' : 'Bản nháp'}
                  </small>
                  <div className="popular-track" aria-hidden="true">
                    <span
                      style={{
                        width: `${(story.readCount / Math.max(1, stats.popularStories[0]!.readCount)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <strong>
                  {number(story.readCount)} <small>lượt</small>
                </strong>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
