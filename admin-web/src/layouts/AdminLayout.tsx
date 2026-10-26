import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import {
  BookOpen,
  ChevronRight,
  FileStack,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  ShieldCheck,
  Tags,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../features/auth/auth-context';
import { Brand } from '../components/Brand';

export function AdminLayout() {
  const { pathname } = useLocation();
  const section = pathname.startsWith('/users')
    ? 'Quản lý người dùng'
    : pathname === '/genres'
      ? 'Quản lý thể loại'
      : pathname === '/comments'
        ? 'Kiểm duyệt bình luận'
        : pathname.includes('/chapters')
          ? pathname.endsWith('/new')
            ? 'Tạo chương mới'
            : pathname.endsWith('/edit')
              ? 'Chỉnh sửa chương'
              : pathname.endsWith('/chapters')
                ? 'Danh sách chương'
                : 'Chi tiết chương'
          : pathname === '/stories/import-epub'
            ? 'Nhập EPUB'
            : pathname === '/stories/new'
              ? 'Tạo truyện mới'
              : pathname.endsWith('/edit')
                ? 'Chỉnh sửa truyện'
                : pathname === '/stories'
                  ? 'Stories'
                  : pathname.startsWith('/stories/')
                    ? 'Chi tiết truyện'
                    : 'Dashboard';
  const { view, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLElement>('button')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
      if (event.key === 'Tab') {
        const items = sidebar.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled])',
        );
        const first = items?.[0];
        const last = items?.[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', keyboard);
    };
  }, [open]);
  const user = view.user!;
  const initials = user.displayName.trim().slice(0, 1).toUpperCase() || 'A';
  return (
    <div className="admin-shell">
      <a href="#main-content" className="skip-link">
        Đến nội dung chính
      </a>
      {open && (
        <button
          className="sidebar-overlay"
          aria-label="Đóng menu"
          onClick={() => {
            setOpen(false);
            toggle.current?.focus();
          }}
        />
      )}
      <aside
        ref={sidebar}
        id="admin-navigation"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        aria-label={open ? 'Điều hướng quản trị' : undefined}
        className={`sidebar ${open ? 'sidebar-open' : ''}`}
      >
        <div className="sidebar-brand">
          <Brand light />
          <button
            className="icon-button mobile-close"
            aria-label="Đóng điều hướng"
            onClick={() => {
              setOpen(false);
              toggle.current?.focus();
            }}
          >
            <X size={22} />
          </button>
        </div>
        <div className="workspace-tag">
          <span className="workspace-square">W</span>
          <span>
            Không gian quản trị<small>WebNovel Workspace</small>
          </span>
          <ShieldCheck size={16} />
        </div>
        <nav aria-label="Điều hướng chính">
          <p className="nav-heading">KHÔNG GIAN LÀM VIỆC</p>
          <NavLink
            to="/dashboard"
            className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}
            onClick={() => {
              setOpen(false);
              if (open) toggle.current?.focus();
            }}
          >
            <LayoutDashboard size={19} />
            <span>Dashboard</span>
            <ChevronRight className="nav-arrow" size={16} />
          </NavLink>
          <NavLink
            to="/stories"
            className={({ isActive }) =>
              `nav-item ${isActive && !pathname.includes('/chapters') ? 'nav-active' : ''}`
            }
            aria-current={pathname.includes('/chapters') ? false : 'page'}
            onClick={() => {
              setOpen(false);
              if (open) toggle.current?.focus();
            }}
          >
            <BookOpen size={19} />
            <span>Stories</span>
            <ChevronRight className="nav-arrow" size={16} />
          </NavLink>
          <Link
            to="/stories"
            className={`nav-item ${pathname.includes('/chapters') ? 'nav-active' : ''}`}
            title="Chọn truyện trong Stories để quản lý chương"
            onClick={() => {
              setOpen(false);
              if (open) toggle.current?.focus();
            }}
          >
            <FileStack size={19} />
            <span>Chapters</span>
            <span className="soon">Theo truyện</span>
          </Link>
          {[
            { path: '/users', label: 'Users', icon: Users },
            { path: '/genres', label: 'Genres', icon: Tags },
            { path: '/comments', label: 'Comments', icon: MessageSquare },
          ].map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => `nav-item ${isActive ? 'nav-active' : ''}`}
              onClick={() => {
                setOpen(false);
                if (open) toggle.current?.focus();
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
              <ChevronRight className="nav-arrow" size={16} />
            </NavLink>
          ))}
          <p className="nav-heading nav-heading-system">HỆ THỐNG</p>
          <button
            type="button"
            className="nav-item nav-disabled"
            disabled
            title="Settings: chưa triển khai"
          >
            <Settings size={19} />
            <span>Settings</span>
            <span className="soon">Sắp có</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-access">
            <ShieldCheck size={21} />
            <div>
              Quyền quản trị<small>Truy cập bằng tài khoản ADMIN</small>
            </div>
          </div>
          <div className="sidebar-version">
            WebNovel Admin Studio<span>14.4</span>
          </div>
        </div>
      </aside>
      <div className="admin-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              ref={toggle}
              className="icon-button menu-toggle"
              aria-label="Mở điều hướng"
              aria-expanded={open}
              aria-controls="admin-navigation"
              onClick={() => setOpen(!open)}
            >
              <Menu size={22} />
            </button>
            <span>Không gian làm việc</span>
            <ChevronRight size={15} />
            <strong>{section}</strong>
          </div>
          <div className="topbar-right">
            <div className="header-user">
              <span className="avatar">{initials}</span>
              <div>
                {user.displayName}
                <small>Quản trị viên</small>
              </div>
            </div>
            <span className="header-divider" />
            <button
              className="logout-button"
              onClick={() => {
                void logout();
              }}
            >
              <LogOut size={17} />
              <span>Đăng xuất</span>
            </button>
          </div>
        </header>
        <main id="main-content" className="workspace-content">
          <Outlet />
        </main>
        <footer className="workspace-footer">
          <span>WebNovel Admin Studio</span>
          <span>Không gian dành cho những câu chuyện.</span>
        </footer>
      </div>
    </div>
  );
}
