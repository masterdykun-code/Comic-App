import { Link } from 'react-router';
import { BookOpen } from 'lucide-react';
export function NotFoundPage() {
  return (
    <main className="not-found">
      <BookOpen size={42} />
      <span className="eyebrow">TRANG CHƯA CÓ SẴN</span>
      <h1>Chương này chưa được viết.</h1>
      <p>Đường dẫn không tồn tại hoặc chức năng chưa được triển khai.</p>
      <Link to="/dashboard" className="button button-primary">
        Về Dashboard
      </Link>
    </main>
  );
}
