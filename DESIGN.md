---
wiki_role: wiki
type: design-spec
version: 1.0
status: confirmed
project: 이레이지(Erasy) service-app
tone: 토스풍 (신뢰 + 친근)
brand_accent: "#0b63f6"
target_engineer: neo (Engine Room FE)
base_stack: Next.js 16 + Astryx 0.1.4 (커스텀 CSS 오버라이드)
related:
  - "[[team-architecture-v1]]"
  - "[[design-spec-template]]"
  - "[[awesome-design-md]]"
generated: 2026-07-10
---

# Erasy service-app — 토스풍 디자인 스펙 (neo 구현 핸드오프)

> 목표: 기업 SaaS 톤(각진 버튼·가로 바 점수·약한 그림자·좁은 여백)을 **토스풍(신뢰 + 친근)**으로 전환.
> 원칙: 브랜드 블루 `#0b63f6` 유지 · pill 버튼 · 큰 점수 숫자 · 넓은 여백 · soft shadow · 말랑 마이크로 애니.
> 금기: gradient/glassmorphism 남용, 이모지 남발, 과한 캐주얼(심사 대상). 정직 표기·비가역 게이트 문구는 디자인만, 내용 보존.

## 구현 아키텍처 (neo 필독)

| 항목 | 사실 | 함의 |
|------|------|------|
| Tailwind | `globals.css`에서 비활성 (oxide IPC hang, 메모리 확정) | **유틸 클래스 금지.** 순수 CSS만 |
| 토큰 스코프 | `[data-astryx-theme="ink-violet"]` scope 내 CSS 변수 | 이 스코프 안 변수 오버라이드는 허용(`:root` 오버라이드 아님) |
| 컴포넌트 클래스 | `.astryx-button`, `.astryx-card`, `.astryx-progressbar`, `.astryx-badge` 등 | 이 클래스에 CSS 오버라이드 얹어 스타일 변경 |
| 오버라이드 파일 | 신규 `theme/erasy-toss.css` 생성 → `app/layout.tsx`에서 `globals.css` **다음(마지막)** import | 로드 순서: reset → astryx → tailwind-theme → ink-violet → globals → **erasy-toss** |
| 신규 컴포넌트 | 게이지/축하 모션은 순수 SVG + rAF (신규 dep 0, `TrendSparkline`·`AnimatedScore` 패턴 준용) | `pnpm add` 없이 구현 |

`astryx theme build` 재생성 경로는 **선택**(radius/shadow 토큰 전역 변경 시). 기본은 `erasy-toss.css` 오버라이드로 진행 — CLI hang 리스크 회피.

`app/layout.tsx` 추가 1줄:
```ts
import "./globals.css";
import "@/theme/erasy-toss.css"; // 토스풍 오버라이드(마지막 로드)
```

---

## 1. Visual Theme & Atmosphere

이레이지는 "흩어진 내 계정을 되찾는" 개인 프라이버시 서비스다. 사용자는 불안(유출·미사용 계정)을 안고 들어와 안심을 얻고 나가야 한다. 그래서 톤은 **금융앱의 신뢰감**과 **친구가 정리를 도와주는 다정함**의 교차점 — 토스가 송금이라는 긴장된 행위를 말랑한 인터랙션으로 감싸 신뢰를 만든 방식을 차용한다.

핵심 정서는 세 가지다. **가벼움**: 넓은 여백과 둥근 형태로 화면이 숨 쉬게 한다. 정보 밀도로 압박하지 않는다. **또렷함**: 안전도 점수는 화면에서 가장 크고 명확한 단 하나의 주인공이다. 사용자가 3초 안에 "나 지금 괜찮은가?"에 답을 얻는다. **따뜻한 진전감**: 정리할 때마다 점수가 오르고, 그 상승을 숫자·색·모션으로 축하한다 — 보안이 숙제가 아니라 성취가 되게. 단, 프라이버시 제품의 격을 지킨다. 파스텔은 쓰되 유치하지 않게, 모션은 넣되 과장 없이(120~700ms), 이모지 대신 그래픽 언어로 감정을 전한다.

---

## 2. Color Palette & Roles

`#0b63f6`는 브랜드 코어로 **유지**. 톤을 부드럽게 만드는 건 색 자체를 바꾸는 게 아니라, (1) 솔리드 채움은 CTA·점수 등 핵심에만 절제해 쓰고 (2) 넓은 면적엔 연한 블루 틴트를 깔고 (3) 등급색을 파스텔로 낮춰 대비 스트레스를 줄이는 방식이다.

### 브랜드 블루

| 토큰 | 값 | 역할 |
|------|-----|------|
| `--erasy-blue` | `#0b63f6` | 브랜드 코어. primary 버튼·게이지 arc·강조 (보존) |
| `--erasy-blue-hover` | `#0a58dd` | primary hover(살짝 진하게) |
| `--erasy-blue-press` | `#0950c4` | primary active |
| `--erasy-blue-tint` | `#eaf1fe` | secondary 버튼 bg·틴트 서페이스·selected 배경 |
| `--erasy-blue-tint-strong` | `#d7e6fd` | tint hover |
| `--erasy-blue-ink` | `#0a4fc4` | tint 위 텍스트(대비 확보) |

### 등급 파스텔 (green/amber/red — 점수·리스크 공통)

| 등급 | 토큰 | 값 | 용도 |
|------|------|-----|------|
| 양호(≥80) | `--erasy-good` / `-soft` / `-ink` | `#16a34a` / `#e9f8ef` / `#0f7a37` | arc·링·아이콘 / 배경 / 텍스트 |
| 주의(50~79) | `--erasy-warn` / `-soft` / `-ink` | `#f59e0b` / `#fef5e3` / `#a86a00` | 〃 |
| 위험(<50) | `--erasy-bad` / `-soft` / `-ink` | `#ef4444` / `#fdecec` / `#c02a2a` | 〃 |

> 등급 매핑은 코드 SSOT `deriveGrade`(≥80 양호 / ≥50 주의 / else 위험) · `gradeTone` 준수. 하드코딩 금지.

### 중립·서페이스

| 토큰 | 값 | 역할 |
|------|-----|------|
| `--erasy-bg` | `#f7f9fc` | 앱 배경(현 `#f1f1f1`보다 살짝 블루 기운·밝게) |
| `--erasy-surface` | `#ffffff` | 카드·팝오버 |
| `--erasy-border` | `#eef1f5` | 카드 테두리(아주 옅게) |
| `--erasy-track` | `#eef2f7` | 게이지/프로그레스 트랙 |
| `--erasy-text` | `#191f28` | 본문(토스 잉크블랙 계열) |
| `--erasy-text-sub` | `#6b7684` | 보조 |
| `--erasy-text-weak` | `#8b95a1` | 캡션·disclaimer |

CSS (erasy-toss.css 상단):
```css
[data-astryx-theme="ink-violet"] {
  --erasy-blue:#0b63f6; --erasy-blue-hover:#0a58dd; --erasy-blue-press:#0950c4;
  --erasy-blue-tint:#eaf1fe; --erasy-blue-tint-strong:#d7e6fd; --erasy-blue-ink:#0a4fc4;
  --erasy-good:#16a34a; --erasy-good-soft:#e9f8ef; --erasy-good-ink:#0f7a37;
  --erasy-warn:#f59e0b; --erasy-warn-soft:#fef5e3; --erasy-warn-ink:#a86a00;
  --erasy-bad:#ef4444;  --erasy-bad-soft:#fdecec;  --erasy-bad-ink:#c02a2a;
  --erasy-bg:#f7f9fc; --erasy-surface:#ffffff; --erasy-border:#eef1f5;
  --erasy-track:#eef2f7; --erasy-text:#191f28; --erasy-text-sub:#6b7684; --erasy-text-weak:#8b95a1;
}
body { background: var(--erasy-bg); }
```

---

## 3. Typography Rules

Astryx display 스케일(display-2 = 35px)은 토스풍 "큰 점수"엔 부족. 점수 전용 대형 스텝을 추가한다. 나머지 위계는 Astryx `Heading/Text` 유지.

| 역할 | size | weight | line-height | letter-spacing | 비고 |
|------|------|--------|-------------|----------------|------|
| Score XL (게이지 중앙) | `3.5rem` (56px) | 700 | 1.0 | `-0.02em` | `font-variant-numeric: tabular-nums` |
| Score L (인라인 62→85) | `2.75rem` (44px) | 700 | 1.05 | `-0.02em` | tabular-nums |
| Page title (h1) | Astryx 2xl(24px) | 600 | 1.33 | `-0.01em` | 유지 |
| Section (h4) | Astryx base(14px) bold | 700 | 1.43 | — | 유지 |
| Body | 15px | 400 | 1.6 | — | 가독 위해 14→15 상향(오버라이드) |
| Caption/label | 13px | 500 | 1.5 | — | secondary color |

CSS:
```css
[data-astryx-theme="ink-violet"] {
  --erasy-score-xl: 3.5rem; --erasy-score-l: 2.75rem;
}
.erasy-score-num { font-size:var(--erasy-score-xl); font-weight:700; line-height:1;
  letter-spacing:-.02em; font-variant-numeric:tabular-nums; color:var(--erasy-text); }
/* 본문 가독 상향(15px) */
[data-astryx-theme="ink-violet"] .astryx-text.body { font-size:.9375rem; line-height:1.6; }
```
반응형: 모바일에서 Score XL `2.75rem`, Score L `2.25rem`로 축소(9번 미디어쿼리).

---

## 4. Component Stylings

### 4.1 버튼 시스템 (pill · soft shadow · 말랑 상태)

3위계 × 3사이즈. 모두 pill(`border-radius:9999px`). Astryx `Button`은 그대로 쓰되 `.astryx-button`에 CSS 오버라이드.

| 위계 | Background | Text | Shadow | Hover | Press | 매핑 |
|------|-----------|------|--------|-------|-------|------|
| **primary** | `--erasy-blue` | `#fff` | `0 4px 12px rgba(11,99,246,.24)` | bg→hover, `translateY(-1px)`, shadow `0 6px 16px rgba(11,99,246,.32)` | `translateY(0) scale(.98)`, bg→press | 구글로 시작하기 / 침해 알림 확인하기 |
| **secondary** | `--erasy-blue-tint` | `--erasy-blue-ink` | none | bg→tint-strong, `translateY(-1px)` | `scale(.98)` | 요청 접수 / 보조 CTA |
| **ghost** | transparent | `--erasy-blue-ink` | none | bg `--erasy-blue-tint` | `scale(.98)` | 점수 올리는 법 / 구글 보안 설정 직접 관리(+외부링크 아이콘) |

사이즈(높이 / 좌우 padding / font):

| size | height | padding-x | font | 용도 |
|------|--------|-----------|------|------|
| lg | 52px | 24px | 16px/600 | 로그인·주요 CTA(풀폭 가능) |
| md | 44px | 20px | 15px/600 | 기본 |
| sm | 36px | 14px | 14px/600 | 인라인·보조 |

상태:
- **hover lift**: `transition: transform .12s, box-shadow .12s, background .12s;` `translateY(-1px)`
- **press**: `:active` `transform: translateY(0) scale(.98)`
- **loading**: label 자리 12px 스피너(회전 `.8s linear infinite`), 버튼 폭 유지, `pointer-events:none; opacity:.85`
- **success**: 배경 `--erasy-good`로 0.2s 트랜지션 + 체크 아이콘 stroke-draw(성공 피드백. "요청 접수" 완료 시)
- **아이콘 동반**: 아이콘-라벨 gap 8px, 아이콘 18px, 라벨 앞(leading) 배치 기본

CSS:
```css
[data-astryx-theme="ink-violet"] .astryx-button {
  border-radius:9999px !important;
  transition:transform .12s ease, box-shadow .12s ease, background-color .12s ease;
}
.astryx-button.primary { background:var(--erasy-blue); color:#fff;
  box-shadow:0 4px 12px rgba(11,99,246,.24); }
.astryx-button.primary:hover { background:var(--erasy-blue-hover);
  transform:translateY(-1px); box-shadow:0 6px 16px rgba(11,99,246,.32); }
.astryx-button.primary:active { background:var(--erasy-blue-press);
  transform:translateY(0) scale(.98); box-shadow:0 2px 6px rgba(11,99,246,.2); }
.astryx-button.secondary { background:var(--erasy-blue-tint); color:var(--erasy-blue-ink); box-shadow:none; }
.astryx-button.secondary:hover { background:var(--erasy-blue-tint-strong); transform:translateY(-1px); }
.astryx-button.ghost:hover { background:var(--erasy-blue-tint); }
@media (prefers-reduced-motion:reduce){ .astryx-button{ transition:background-color .12s; }
  .astryx-button:hover,.astryx-button:active{ transform:none; } }
```
> Astryx Button variant 이름이 solid/soft/ghost일 수 있음 — `astryx component Button`으로 실제 클래스 확인 후 셀렉터 정합(primary=solid, secondary=soft/tinted 매핑). agent-browser로 실측 권장.

### 4.2 카드

| 속성 | 값 |
|------|-----|
| Background | `--erasy-surface` |
| Radius | `16px`(기본), 점수 카드 `20px` |
| Border | `1px solid --erasy-border` |
| Shadow | elevation-1 (아래 6번) |
| Padding | 24px(기본) / 28px(점수·히어로 카드) |
| Hover(ClickableCard) | `translateY(-2px)` + elevation-2, `.16s ease` |

```css
[data-astryx-theme="ink-violet"] .astryx-card {
  border-radius:16px; border:1px solid var(--erasy-border);
  box-shadow:var(--erasy-elev-1); --astryx-card-padding:24px;
}
[data-astryx-theme="ink-violet"] .astryx-clickablecard {
  transition:transform .16s ease, box-shadow .16s ease; }
[data-astryx-theme="ink-violet"] .astryx-clickablecard:hover {
  transform:translateY(-2px); box-shadow:var(--erasy-elev-2); }
```

### 4.3 입력(Input/계정 선택)

| 속성 | 값 |
|------|-----|
| Radius | 12px |
| Border | `1px solid --erasy-border` |
| Focus | border `--erasy-blue`, ring `0 0 0 3px rgba(11,99,246,.15)` |
| Height | 48px |

### 4.4 배지·토큰·StatusDot

pill 유지(이미 둥금). 등급 배지는 파스텔 매핑: 양호=good-soft/ink, 주의=warn-soft/ink, 위험=bad-soft/ink. "예시 데이터"·"데모" 배지는 현행 warning 노랑 유지(정직 표기 — 눈에 띄어야 함).

---

## 5. Layout Principles

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--erasy-space-1` | 4px | 인접 요소 |
| `--erasy-space-2` | 8px | 아이콘-텍스트 |
| `--erasy-space-3` | 16px | 카드 내 블록 |
| `--erasy-space-4` | 24px | 카드 padding·카드 간 gap |
| `--erasy-space-5` | 32px | 섹션 간 |
| `--erasy-space-6` | 48px | 페이지 상단·주요 섹션 분리 |

- **콘텐츠 max-width**: 대시보드 본문 `1040px` 중앙 정렬(현재 풀폭 → 여백 확보). 로그인 카드 `440px`.
- **그리드**: KPI 4열(`minWidth:160`), 위험/활동 2열, 추천액션 3열 — 현 구조 유지, gap을 `--erasy-space-4`(24px)로 상향.
- **여백 상향**: 화면 상하 padding `40px`, 카드 간 24px(현 16→24). Astryx `VStack gap`을 5→6, `padding={5}`→`padding={6}` 조정.

---

## 6. Depth & Elevation

토스 시그니처 = **매우 부드럽고 확산된 저채도 그림자**(현 Astryx `--shadow-low`의 dark inset·강한 대비 대신). 3단계.

| Level | Treatment | Use |
|-------|-----------|-----|
| elev-1 | `0 1px 2px rgba(17,24,39,.04), 0 4px 12px rgba(17,24,39,.05)` | 기본 카드·KPI |
| elev-2 | `0 2px 6px rgba(17,24,39,.05), 0 12px 28px rgba(17,24,39,.08)` | hover 카드·팝오버·점수 카드 |
| elev-3 | `0 8px 20px rgba(17,24,39,.08), 0 24px 56px rgba(17,24,39,.12)` | Dialog·모달 |
| blue-glow | `0 4px 12px rgba(11,99,246,.24)` | primary 버튼 전용 |

```css
[data-astryx-theme="ink-violet"] {
  --erasy-elev-1:0 1px 2px rgba(17,24,39,.04), 0 4px 12px rgba(17,24,39,.05);
  --erasy-elev-2:0 2px 6px rgba(17,24,39,.05), 0 12px 28px rgba(17,24,39,.08);
  --erasy-elev-3:0 8px 20px rgba(17,24,39,.08), 0 24px 56px rgba(17,24,39,.12);
}
[data-astryx-theme="ink-violet"] .astryx-dialog { box-shadow:var(--erasy-elev-3); border-radius:20px; }
```

---

## 7. Do's and Don'ts

**Do**
- 안전도 점수를 화면 최대 요소로 — 게이지 + 56px 숫자, 한 화면 한 주인공.
- 파스텔 등급색 + 넉넉한 여백으로 "압박 없는 신뢰".
- 상태 변화(점수 상승·요청 접수)에 짧은 말랑 모션(120~400ms)으로 피드백.
- 따뜻한 마이크로카피("다시 오셨네요", "안전도가 올랐어요").

**Don't**
- gradient 배경·glassmorphism 카드 남용 금지(AI 제네릭 미학).
- 이모지로 감정 전달 금지 → 그래픽(체크·링·글로우)으로.
- 정직 표기("예시 데이터"·"데모 로그인"·"실제 인증 아님") 문구 삭제·약화 금지. 디자인만 정돈.
- 비가역 게이트 문구("연결을 실제로 관리하려면 구글 보안 설정에서 직접 진행하세요") 내용 보존.
- 순채도 `#0b63f6` 대면적 채움 금지(눈 피로) — 대면적은 tint, 솔리드는 CTA·arc만.
- 모션 500ms 초과·바운스 과장 금지. `prefers-reduced-motion` 항상 대응.

---

## 8. Responsive Behavior

| 브레이크포인트 | 폭 | 레이아웃 |
|----------------|-----|----------|
| Mobile | `< 768px` | 단일 컬럼. KPI 2열, 위험/활동·추천액션 1열 stack. SideNav→하단/드로어. 게이지 160px, Score `2.75rem`. 버튼 풀폭. 본문 padding 20px |
| Tablet | `768–1023px` | KPI 2열, 나머지 2열. SideNav collapsible(현행). padding 32px |
| Desktop | `≥ 1024px` | 본문 max-width 1040px 중앙. KPI 4열, 게이지 200px, Score `3.5rem`. padding 40px |

콜랩스 전략: Astryx `Grid columns={{minWidth, max}}`가 자동 리플로우 담당 — `minWidth` 유지, gap만 상향. SideNav는 `collapsible`(현행) 유지, 모바일은 AppShell 기본 드로어.

```css
@media (max-width:767px){
  .erasy-score-num{ font-size:2.75rem; }
  .astryx-button.lg{ width:100%; }
}
```

---

## 9. Agent Prompt Guide (neo 복붙용)

> FE가 그대로 붙여 지시할 수 있는 자연어 프롬프트. 우선순위 순.

1. **"`theme/erasy-toss.css`를 새로 만들고 `app/layout.tsx`에서 `globals.css` 다음(마지막)에 import해. 이 파일에 2·3·6번 섹션의 CSS 변수 블록(브랜드 블루·등급 파스텔·중립·elevation·score 타이포)을 `[data-astryx-theme="ink-violet"]` 스코프로 넣어. `:root`나 `--color-*`는 건드리지 마. Tailwind 유틸 금지(oxide hang) — 순수 CSS만."**

2. **"`.astryx-button`을 pill(`border-radius:9999px`)로 바꾸고 primary/secondary/ghost에 4.1번 표대로 배경·soft shadow·hover lift(translateY -1px)·press(scale .98)·loading 스피너·success 체크 상태를 CSS로 얹어. 먼저 `astryx component Button`으로 실제 variant 클래스명 확인하고 셀렉터를 정합시켜. `prefers-reduced-motion`에서 transform 제거."**

3. **"대시보드 `PrivacyScoreCard`를 도넛 게이지로 교체해. `TrendSparkline`처럼 순수 SVG(신규 dep 0): 200px 원, stroke 16px, rounded cap, 트랙 `--erasy-track`, arc는 등급색(`gradeTone`), `stroke-dashoffset`로 점수 비율 채움. 중앙에 56px 점수 숫자(`.erasy-score-num`) + '/100' + 등급 pill, 아래 '▲8 지난주 대비' 델타 칩. 값은 상위 주입(하드코딩 금지). 진입 시 arc가 0→점수로 `.9s ease-out` 스윕."**

4. **"정리 완료 화면(`cleanup`)의 62→85 상승에 축하 모션을 넣어. 이모지 말고 그래픽: 게이지 arc가 62%→85%로 스윕하며 색이 주의(amber)→양호(green)로 전환되고, 기존 `AnimatedScore` 카운트업과 동기화. 80 넘는 순간 중앙 숫자에 soft scale bounce(1→1.06→1) + 링 둘레 green glow pulse 1회. '안전도가 크게 올랐어요' soft green 배너(`--erasy-good-soft` 배경). 700ms 이내, `prefers-reduced-motion`이면 모션 없이 최종값만."**

5. **"카드 전체를 radius 16px(점수 카드 20px), border `--erasy-border`, `--erasy-elev-1` soft shadow로 바꾸고 `ClickableCard`에 hover lift(translateY -2px + elev-2)를 줘. `Dialog`는 radius 20px + elev-3."**

6. **"여백을 토스풍으로 넓혀: 대시보드 본문 max-width 1040px 중앙 정렬, 카드 간 gap 16→24px(`VStack gap 5→6`), 페이지 padding 40px(모바일 20px). 본문 텍스트 14→15px."**

7. **"마이크로카피를 따뜻하게 다듬되(대시보드 인사·빈 상태·성공 메시지) '예시 데이터'·'데모 로그인'·'실제 구글 인증이 아닙니다'·구글 직접 관리 안내 등 정직·비가역 게이트 문구는 `content/copy.ts` 원문 그대로 보존해. 카피 변경은 `copy.ts`에서만(하드코딩 금지)."**

---

## 부록 A. 화면별 적용 가이드

| 화면 | 적용 |
|------|------|
| **로그인 `/`** | 카드 440px·radius 20px·elev-2. "구글로 시작하기" = primary **lg 풀폭** pill + 구글 아이콘. "실제 구글 인증이 아닙니다" 노랑 배지·"데모 로그인" 캡션·하단 disclaimer **원문 보존**. 로고 위 여백 확대, 중앙 정렬 |
| **스캔 `/scanning`·`/scan`** | 스캔 단계 4개를 pill 스텝(체크 draw-in 애니, 순차 200ms stagger). 진행 게이지 accent arc. "예시 데이터" 배지 유지. 완료 시 대시보드 이동 CTA primary md |
| **대시보드 `/dashboard`** | 9번 3·5·6번 전면 적용(게이지·카드·여백). KPI 카드 4열 radius 16 elev-1. 위험분포 바 → 트랙 `--erasy-track`·arc accent, 파스텔. 최근활동 StatusDot 등급 파스텔. 추천액션 ClickableCard hover lift |
| **정리 `/cleanup`** | 62→85 축하 모션(9번 4). "정리 완료·안전도 상승" 카드 elev-2. "침해 알림 확인하기" primary md. "구글 보안 설정에서 직접 관리" = ghost + 외부링크 아이콘, **문구 보존**. "요청 접수" secondary. 탭(연결앱/삭제요청) 언더라인 accent |
| **침해 `/breach`** | BreachCard radius 16·elev-1. 위험 항목 `--erasy-bad-soft` 배경 좌측 accent bar. 조치 가이드 secondary 버튼. resolved 항목 good 파스텔 |

## 부록 B. UI 레퍼런스 매핑

| 요소 | 레퍼런스 | 근거 |
|------|----------|------|
| pill 버튼·soft blue shadow·hover lift | 토스(toss.im) | 신뢰+친근 톤 코어. 송금 CTA의 말랑 인터랙션 |
| 큰 점수 숫자·중앙 게이지 | 토스 신용점수·뱅크샐러드 자산 스코어 | "3초 안에 상태 파악" 원페이지 스코어 |
| 저채도 확산 그림자·radius 16 | linear.app / vercel.com (VoltAgent awesome-design-md DESIGN.md) | soft elevation·둥근 카드 수치 참고 |
| 파스텔 semantic + 잉크블랙 텍스트 | 토스 디자인 시스템(TDS) | 압박 없는 등급 표현 |
| 축하 모션(글로우·bounce, no emoji) | 토스 완료 화면 / stripe 성공 트랜지션 | 성취감 전달, 격 유지 |

> 출처: awesome-design-md는 VoltAgent 풀 `linear`·`vercel` DESIGN.md 참조. 토스·뱅크샐러드는 국내 보강(awesome 풀 외).

## 부록 C. 최종 산출물 리스트 (neo 생성/수정)

| 파일 | 작업 |
|------|------|
| `theme/erasy-toss.css` | **신규** — 토큰·버튼·카드·게이지·모션 오버라이드 전량 |
| `app/layout.tsx` | import 1줄 추가 |
| `components/PrivacyScoreCard.tsx` | 게이지로 교체(신규 `components/ScoreGauge.tsx` 분리 권장) |
| `components/ScoreGauge.tsx` | **신규** — 순수 SVG 도넛 게이지(등급색·스윕 애니) |
| `components/AnimatedScore.tsx` | 축하 모션 결합(게이지 스윕·색전환·bounce) |
| `app/(app)/dashboard/page.tsx` | 여백·gap·max-width 조정 |
| `app/(app)/cleanup/page.tsx` | 축하 배너·게이지 연동 |
| `app/(app)/layout.tsx` · `app/page.tsx` | padding·버튼 위계 적용 |
| `content/copy.ts` | (필요 시) 따뜻한 카피 — 정직·게이트 문구 보존 |

**검증 게이트**: agent-browser로 3 브레이크포인트(375/768/1280) 시각 확인 + 62→85 축하 모션 + `prefers-reduced-motion` 실측. Argus QA 회귀 권장. (런타임 실측 전까지 "1차 적용" 톤)
