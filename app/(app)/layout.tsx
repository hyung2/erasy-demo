'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { currentUser } from '@/lib/dummy-data';

// 디자이너 정본 사이드바(순수 클래스 마크업). body.app → .erasy-app wrapper.
const NAV = [
  { label: '대시보드', href: '/dashboard' },
  { label: '계정 스캔', href: '/scan' },
  { label: '침해 알림', href: '/breach' },
  { label: '정리하기', href: '/cleanup' },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="erasy-app">
      <aside className="sidebar">
        <Link href="/dashboard" className="logo">
          Erasy
        </Link>
        <nav aria-label="주요 메뉴">
          {NAV.map((n) => {
            const active = pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`nav-link${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="user">
          <span className="avatar-sm">{currentUser.name.slice(0, 1)}</span>
          {currentUser.name} 님
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
