// 랜딩 카피 단일 소스. 문구는 여기서만 수정(하드코딩 금지).
// 원본: 02-deliverables/landing-copy-v1.md (c3po, T1.4) + mockup-spec-v1.md 화면 ① 랜딩.

export type CtaLink = { label: string; href: string };

export const brand = {
  name: '이레이지', // 한글 프로즈 표기
  nameEn: 'Erasy', // 영문 워드마크(로고·footer)
  tagline: '이레이지 — 어렵던 계정 정리, 쉽게. Erasy.',
} as const;

export const landing = {
  login: { label: '로그인', href: '/dashboard' } as CtaLink,

  hero: {
    headline: '흩어진 내 디지털 계정, 한 화면에서 정리하고 실시간으로 지킵니다.',
    subhead:
      '구글·카카오 소셜로그인과 넷플릭스 같은 해외 구독으로 계정은 수십 곳에 흩어져 있습니다. 이레이지는 그 계정을 대신 지워주는 대행이 아니라, 사용자가 직접 보고 끊고 지키게 합니다. 한눈에 모아 보여주고, 안 쓰는 소셜 연결을 표준 방식으로 끊고, 유출을 실시간으로 알립니다.',
    ctaPrimary: { label: '30초 데모 보기', href: '/scan' } as CtaLink,
    ctaSecondary: { label: '차별점 한눈에 보기', href: '/dashboard' } as CtaLink,
    brandHook: 'Erasy · 이레이지',
    visual: {
      scoreLabel: '안전도 점수',
      countPrefix: '확인된',
      countSuffix: '개 계정',
      exampleBadge: '예시 데이터',
      bulk: { label: '안 쓰는 연결 일괄 로그아웃', href: '/cleanup' } as CtaLink,
    },
  },

  problem: {
    eyebrow: '왜 지금 필요한가',
    cards: [
      {
        title: '흩어진 계정',
        body: '소셜로그인 한 번, 해외 구독 결제 한 번에 내 계정은 여기저기 새겨집니다. 어디에 남았는지 아무도 모읍니다.',
      },
      {
        title: '보이지 않는 유출',
        body: '내 계정이 어디서 털렸는지 사후에도 알려주는 곳이 없습니다. 유출은 이미 벌어지고 있습니다.',
      },
      {
        title: '정부 사각지대',
        body: 'e프라이버시는 주민번호로 가입한 국내 사이트만 봅니다. 소셜·해외 서비스는 그대로 사각지대입니다.',
      },
    ],
  },

  howItWorks: {
    title: '보고 · 끊고 · 지키게 합니다',
    steps: [
      { label: '스캔', body: '흩어진 소셜·해외 계정을 한 번에 스캔해 한눈에 가시화합니다.' },
      { label: '정리', body: '안 쓰는 소셜 연결을 OAuth 표준 방식으로 안전하게 끊습니다.' },
      { label: '알림', body: '유출 데이터베이스와 대조해 침해를 실시간으로 알립니다.' },
      { label: '삭제 요청', body: '삭제가 필요한 계정은 표준 절차에 따라 요청을 접수합니다.' },
    ],
  },

  cta: {
    headline: '흩어진 계정, 오늘 몇 분이면 정리됩니다.',
    subhead: '어렵던 계정 정리, 지금 몇 분이면 쉽게 끝납니다.',
    button: { label: '30초 데모 보기', href: '/scan' } as CtaLink,
  },
} as const;

// 실서비스 데모 흐름 문구(로그인 진입 · 스캔 연출 · 정리 결과). 전부 연출 — 실제 인증/백엔드 없음.
export const demo = {
  login: {
    eyebrow: '데모 로그인',
    notice: '실제 구글 인증이 아닙니다 · 연출 데모',
    headline: '흩어진 계정, 한 화면에서 되찾기',
    subhead: '로그인하면 흩어진 계정을 스캔해 안전도 점수와 함께 보여드립니다.',
    google: '구글로 시작하기',
    pickerTitle: '계정 선택',
    pickerNotice: '연출용 예시 계정입니다. 실제 로그인은 이뤄지지 않습니다.',
    accounts: [
      { name: '김민준', email: 'minjun.kim@example.com' },
      { name: '이서연', email: 'seoyeon.lee@example.com' },
    ],
    disclaimer: '이 데모의 계정 · 점수 · 유출 내역은 제품 이해를 돕기 위한 예시 데이터입니다. 실제 인증 · 백엔드 · 유출 조회는 이뤄지지 않습니다.',
  },
  scanning: {
    title: '계정을 찾는 중…',
    subtitle: '구글 · 카카오 · 네이버 로그인 이력과 해외 구독을 훑고 있습니다.',
    steps: [
      '소셜 로그인 연결 확인',
      '해외 구독 서비스 조회',
      '유출 데이터베이스 대조',
      '안전도 점수 산출',
    ],
    badge: '예시 데이터',
    done: '스캔 완료 · 대시보드로 이동합니다',
  },
  // 로그인 후 5초 위험 알림 모달(정리 전 상태에서만·흐름당 1회). 연출·예시.
  riskAlert: {
    title: '계정 위험 알림',
    bodyPrefix: '위험 계정 ',
    bodySuffix: '개가 발견됐어요',
    desc: '유출되었거나 오래 방치된 계정이 지금 위험 신호를 보내고 있어요. 스캔에서 확인하고 정리해 보세요.',
    cta: '위험 계정 확인하기',
    later: '나중에',
    badge: '예시',
  },
  // 또래 벤치마크 차트(월별 6개월). 30대 또래 평균은 예시 연출값.
  benchmark: {
    title: '또래 대비 내 안전도',
    sub: '월별 · 최근 6개월',
    me: '나',
    peer: '또래 평균',
    badge: '예시',
    below: '또래 평균보다 낮아요',
    above: '또래 평균보다 높아요',
    about: '또래 평균과 비슷해요',
    peerNote: '30대 또래 평균(예시)',
  },
  cleanup: {
    riseLabel: '정리 완료 · 안전도 상승',
    celebrate: '안전도가 크게 올랐어요',
    riseNote: '예시 데이터',
    afterCta: { label: '유출 확인하기', href: '/breach' } as CtaLink,
    googleManage: {
      label: '구글 보안 설정에서 직접 관리',
      href: 'https://myaccount.google.com/permissions',
    },
  },
} as const;
