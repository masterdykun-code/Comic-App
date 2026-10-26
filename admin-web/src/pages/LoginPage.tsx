import { useState } from 'react';
import { Navigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { loginSchema, type LoginInput } from '../types/auth';
import { useAuth } from '../features/auth/auth-context';
import { safeError } from '../lib/api/errors';
import { Brand } from '../components/Brand';
import { Alert } from '../components/Alert';
export function LoginPage() {
  const { session, view } = useAuth();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  if (view.status === 'authenticated') return <Navigate to="/dashboard" replace />;
  async function submit(input: LoginInput) {
    setError(null);
    try {
      await session.login(input);
    } catch (failure) {
      setError(safeError(failure).message);
    } finally {
      resetField('password');
      setVisible(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story" aria-label="WebNovel Admin Studio">
        <Brand light />
        <div className="login-story-content">
          <span className="eyebrow light">
            <span className="tiny-line" /> KHÔNG GIAN QUẢN TRỊ
          </span>
          <h1>
            Nơi những câu chuyện
            <br />
            được <em>chăm chút.</em>
          </h1>
          <p>
            Một không gian tập trung để phát triển thư viện
            <br className="desktop-break" /> và kết nối những câu chuyện với độc giả.
          </p>
          <div className="book-art" aria-hidden="true">
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-book back-book" />
            <div className="art-book front-book">
              <span className="art-star">
                <Sparkles size={35} strokeWidth={1.2} />
              </span>
              <span className="art-book-line" />
              <span className="art-book-line short" />
              <span className="art-book-label">A WORLD OF STORIES</span>
            </div>
            <div className="art-caption">
              <span className="live-dot" /> Không gian cho những ý tưởng lớn
            </div>
          </div>
        </div>
        <footer className="login-story-footer">
          <span>WEBNOVEL / ADMIN</span>
          <span>Được xây dựng cho người kể chuyện.</span>
        </footer>
      </section>
      <section className="login-form-panel">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <span className="secure-label">
          <ShieldCheck size={16} aria-hidden="true" /> KHU VỰC DÀNH CHO QUẢN TRỊ VIÊN
        </span>
        <div className="login-form-wrap">
          <span className="login-icon">
            <LockKeyhole size={25} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <h2>Chào mừng trở lại</h2>
          <p className="login-subtitle">Đăng nhập để vào không gian quản trị WebNovel.</p>
          {view.notice && !error && <Alert kind="info">{view.notice}</Alert>}
          {error && <Alert>{error}</Alert>}
          <form onSubmit={handleSubmit(submit)} noValidate>
            <div className="field">
              <label htmlFor="email">Địa chỉ email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="Nhập email quản trị viên"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
              />
              {errors.email && (
                <p id="email-error" className="field-error">
                  {errors.email.message}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="password">Mật khẩu</label>
              <div className="password-field">
                <input
                  id="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Nhập mật khẩu của bạn"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  {...register('password')}
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-pressed={visible}
                >
                  {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="field-error">
                  {errors.password.message}
                </p>
              )}
            </div>
            <button
              type="submit"
              className="button button-primary login-submit"
              disabled={isSubmitting || view.status === 'authenticating'}
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle className="spin" size={18} /> Đang đăng nhập…
                </>
              ) : (
                <>
                  Đăng nhập <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="login-access-note">
            <ShieldCheck size={17} aria-hidden="true" />
            <p>
              Chỉ tài khoản có quyền <strong>ADMIN</strong> mới được truy cập.
              <br />
              Tải lại trang sẽ cần đăng nhập lại để bảo vệ phiên của bạn.
            </p>
          </div>
          <div className="login-help">
            Cần hỗ trợ truy cập?
            <br />
            <span>Liên hệ người quản trị hệ thống của bạn.</span>
          </div>
        </div>
        <footer className="login-form-footer">
          WebNovel Admin Studio <span>•</span> Không gian làm việc riêng tư
        </footer>
      </section>
    </main>
  );
}
