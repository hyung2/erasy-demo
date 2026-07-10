import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

// ink-violet 브랜드 액센트만 델타. neutral 나머지는 상속.
// 브랜드명과 분리한 중립 테마명 — 서비스명 변경 시에도 테마는 불변.
// 토큰 오버라이드만 → component override 없음 = SSR 안정, hydration flash 최소.
export const inkVioletTheme = defineTheme({
  name: 'ink-violet',
  extends: neutralTheme,
  tokens: {
    '--color-accent': ['#0b63f6', '#4d8ffb'],
    '--color-text-accent': ['#064bb8', '#7db0ff'],
    '--color-icon-accent': ['#0b63f6', '#4d8ffb'],
    '--color-accent-muted': ['#0b63f633', '#4d8ffb3f'],
  },
});
