'use client';

// 월별 안전도 추이 + 또래 평균 벤치마크(2선). 순수 SVG(외부 dep 0).
// 디자이너 다크 톤: 나=accent 실선, 또래=중립 점선. 값·라벨은 상위 주입(하드코딩 금지).
// 진입(뷰포트) 시 선이 왼→오로 그어지는 draw 연출(clipPath 리빌). reduced-motion 시 즉시 표기.
import { useEffect, useRef, useState } from 'react';

type Props = {
  labels: string[];
  mine: number[];
  peer: number[];
  meLabel: string;
  peerLabel: string;
  min?: number;
  max?: number;
  width?: number;
  height?: number;
};

export function ScoreBenchmarkChart({
  labels,
  mine,
  peer,
  meLabel,
  peerLabel,
  min = 0,
  max = 100,
  width = 640,
  height = 220,
}: Props) {
  const padX = 14;
  const padTop = 34; // 범례 공간
  const padBottom = 26; // 월 라벨 공간
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const span = max - min || 1;
  const n = labels.length;
  const stepX = plotW / Math.max(1, n - 1);

  const toXY = (v: number, i: number) => {
    const x = padX + i * stepX;
    const y = padTop + plotH * (1 - (Math.max(min, Math.min(max, v)) - min) / span);
    return [x, y] as const;
  };
  const poly = (arr: number[]) => arr.map((v, i) => toXY(v, i).join(',')).join(' ');

  const meColor = 'var(--accent)';
  const peerColor = 'var(--text-mute)';
  const grid = [min, (min + max) / 2, max];

  const ref = useRef<SVGSVGElement>(null);
  const [drawn, setDrawn] = useState(false);

  // 뷰포트 진입 시 draw 트리거(1회). IO 미지원 시 즉시 표기.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setDrawn(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${meLabel} 월별 안전도와 ${peerLabel} 비교`}
      className={`bench-chart${drawn ? ' is-drawn' : ''}`}
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      <defs>
        <clipPath id="bench-draw-clip">
          <rect className="bench-draw-rect" x={0} y={0} width={width} height={height} />
        </clipPath>
      </defs>
      {/* 범례 */}
      <g>
        <circle cx={padX + 4} cy={12} r={4} fill={meColor} />
        <text x={padX + 14} y={16} style={{ fontSize: '12px', fontWeight: 600 }} fill="var(--text)">
          {meLabel}
        </text>
        <circle cx={padX + 58} cy={12} r={4} fill={peerColor} />
        <text x={padX + 68} y={16} style={{ fontSize: '12px', fontWeight: 600 }} fill="var(--text-dim)">
          {peerLabel}
        </text>
      </g>

      {/* 가로 그리드 */}
      {grid.map((g, i) => {
        const [, y] = toXY(g, 0);
        return (
          <g key={i}>
            <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="var(--border-faint)" strokeWidth={1} />
            <text x={width - padX} y={y - 3} textAnchor="end" style={{ fontSize: '10px' }} fill="var(--text-mute)">
              {g}
            </text>
          </g>
        );
      })}

      {/* 데이터 선·점: draw 리빌(clip 왼→오) 대상 */}
      <g clipPath="url(#bench-draw-clip)">
        {/* 또래 평균 (점선) */}
        <polyline
          points={poly(peer)}
          fill="none"
          stroke={peerColor}
          strokeWidth={2}
          strokeDasharray="5 5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {peer.map((v, i) => {
          const [x, y] = toXY(v, i);
          return <circle key={`p${i}`} cx={x} cy={y} r={2.5} fill={peerColor} />;
        })}

        {/* 나 (accent 실선) */}
        <polyline
          points={poly(mine)}
          fill="none"
          stroke={meColor}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {mine.map((v, i) => {
          const [x, y] = toXY(v, i);
          const last = i === mine.length - 1;
          return <circle key={`m${i}`} cx={x} cy={y} r={last ? 4.5 : 3} fill={meColor} />;
        })}
      </g>

      {/* 월 라벨 */}
      {labels.map((lb, i) => {
        const x = padX + i * stepX;
        return (
          <text
            key={`l${i}`}
            x={x}
            y={height - 8}
            textAnchor="middle"
            style={{ fontSize: '11px', fontWeight: 500 }}
            fill="var(--text-mute)"
          >
            {lb}
          </text>
        );
      })}
    </svg>
  );
}
