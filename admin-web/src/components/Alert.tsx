import { CircleAlert, Info } from 'lucide-react';
import type { ReactNode } from 'react';
export function Alert({
  children,
  kind = 'error',
}: {
  children: ReactNode;
  kind?: 'error' | 'info';
}) {
  const Icon = kind === 'error' ? CircleAlert : Info;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={19} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
