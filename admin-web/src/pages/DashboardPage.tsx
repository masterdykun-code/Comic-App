import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  FileStack,
  Layers,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../features/auth/auth-context';
import { Link } from 'react-router';
import { DashboardStatistics } from '../features/users/DashboardStatistics';
const modules = [
  {
    icon: BookOpen,
    title: 'Thư viện truyện',
    text: 'Quản lý tiểu thuyết, truyện tranh và thông tin xuất bản.',
  },
  {
    icon: FileStack,
    title: 'Nội dung chương',
    text: 'Biên tập nội dung chữ và sắp xếp các trang truyện tranh.',
  },
  {
    icon: MessageSquare,
    title: 'Cộng đồng độc giả',
    text: 'Theo dõi thảo luận và kiểm duyệt bình luận của độc giả.',
  },
];
export function DashboardPage() {
  const { view, checking, recheck } = useAuth();
  const user = view.user!;
  const created = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(
    new Date(user.createdAt),
  );
  return (
    <div className="dashboard">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">TỔNG QUAN KHÔNG GIAN</span>
          <h1>Dashboard</h1>
          <p>Chào mừng bạn trở lại. Mọi câu chuyện đều bắt đầu từ đây.</p>
        </div>
        <span className="verified-pill">
          <ShieldCheck size={16} /> Tài khoản đã xác thực
        </span>
      </div>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <span className="banner-label">
            <span className="live-dot" /> WEBNOVEL ADMIN STUDIO
          </span>
          <h2>
            Chào {user.displayName},<br />
            không gian của bạn đã sẵn sàng.
          </h2>
          <p>
            Phiên quản trị đã được xác thực. Bạn có thể kiểm tra thông tin
            <br className="desktop-break" /> tài khoản và theo dõi các chức năng đang được phát
            triển.
          </p>
          <span className="banner-footnote">
            <CheckCheck size={16} /> Kết nối bằng tài khoản quản trị của bạn
          </span>
        </div>
        <div className="welcome-illustration" aria-hidden="true">
          <div className="banner-circle" />
          <div className="illustration-tile tile-back">
            <Layers size={52} strokeWidth={1} />
          </div>
          <div className="illustration-tile tile-front">
            <BookOpen size={58} strokeWidth={1.15} />
            <span>STORIES START HERE</span>
          </div>
          <Sparkles className="banner-sparkle" size={27} strokeWidth={1.4} />
        </div>
      </section>
      <div className="dashboard-grid">
        <section className="panel account-panel">
          <div className="panel-heading">
            <div className="heading-icon">
              <UserRound size={20} />
            </div>
            <div>
              <h2>Tài khoản quản trị</h2>
              <p>Thông tin từ phiên đăng nhập hiện tại</p>
            </div>
            <span className="small-chip">ADMIN</span>
          </div>
          <div className="account-identity">
            <span className="account-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
            <div>
              <h3>{user.displayName}</h3>
              <span>@{user.username}</span>
            </div>
            <span className="active-status">
              <span /> Đang hoạt động
            </span>
          </div>
          <dl className="account-details">
            <div>
              <dt>Địa chỉ email</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>Vai trò</dt>
              <dd>
                Quản trị viên <ShieldCheck size={15} />
              </dd>
            </div>
            <div>
              <dt>Ngày tạo tài khoản</dt>
              <dd>{created}</dd>
            </div>
          </dl>
          <button className="text-button" disabled={checking} onClick={recheck}>
            {checking ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{' '}
            {checking ? 'Đang xác thực…' : 'Kiểm tra lại phiên'}
          </button>
        </section>
        <section className="panel user-detail">
          <div className="panel-heading">
            <span className="heading-icon">
              <UserRound size={20} />
            </span>
            <div>
              <h2>Cộng đồng người dùng</h2>
              <p>Quản lý quyền truy cập tài khoản USER</p>
            </div>
          </div>
          <p className="user-help">
            Tra cứu thông tin người dùng, khóa hoặc mở khóa tài khoản với bước xác nhận. Các tài
            khoản ADMIN luôn được bảo vệ.
          </p>
          <Link className="stories-button secondary" to="/users">
            Mở danh sách người dùng <ArrowUpRight size={16} />
          </Link>
        </section>
      </div>
      <DashboardStatistics />
      <section className="modules-section">
        <div className="section-heading">
          <div>
            <h2>Tiếp theo trong không gian của bạn</h2>
            <p>Các công cụ quản trị sẽ được mở theo từng bước phát triển.</p>
          </div>
          <span className="subtle-label">LỘ TRÌNH PHÁT TRIỂN</span>
        </div>
        <div className="module-grid">
          {modules.map(({ icon: Icon, title, text }) => (
            <article className="module-card" key={title}>
              <div className="module-top">
                <span className="module-icon">
                  <Icon size={22} strokeWidth={1.7} />
                </span>
                <span className="outline-chip">Sẵn sàng</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
              <Link
                className="module-future"
                to={title === 'Cộng đồng độc giả' ? '/comments' : '/stories'}
              >
                {title === 'Thư viện truyện'
                  ? 'Mở thư viện truyện'
                  : title === 'Nội dung chương'
                    ? 'Chọn truyện để quản lý chương'
                    : 'Mở kiểm duyệt bình luận'}{' '}
                <ArrowUpRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      </section>
      <div className="security-note">
        <span className="note-icon">
          <Check size={17} />
        </span>
        <p>
          <strong>Không gian làm việc được bảo vệ.</strong> Chỉ tài khoản ADMIN đang hoạt động có
          thể truy cập. Quyền thao tác luôn được kiểm tra tại máy chủ.
        </p>
      </div>
    </div>
  );
}
