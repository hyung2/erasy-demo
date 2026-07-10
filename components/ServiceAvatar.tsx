import type { CSSProperties } from 'react';
import { brandOf, iconUrl } from '@/lib/dummy-data';

// 서비스 아바타(디자이너 정본 방식). slug 있으면 simple-icons CDN 마크, 없으면 이니셜.
// 크기는 부모 컨텍스트 CSS(.svc .avatar 28 / .breach-card .avatar 40 / 기본 34)가 결정.
export function ServiceAvatar({ service, iconSize = 16 }: { service: string; iconSize?: number }) {
  const b = brandOf(service);
  return (
    <span className={`avatar${b.onLight ? ' on-light' : ''}`} style={{ ['--c' as string]: b.color } as CSSProperties}>
      {b.slug ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="brand-mark"
          src={iconUrl(b.slug)}
          alt={b.initial}
          width={iconSize}
          height={iconSize}
          decoding="async"
        />
      ) : (
        b.initial
      )}
    </span>
  );
}
