import { BookOpen } from 'lucide-react';
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? 'brand-light' : ''}`}>
      <span className="brand-symbol">
        <BookOpen size={23} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="brand-name">
        WebNovel<span className="brand-caption">ADMIN STUDIO</span>
      </span>
    </div>
  );
}
