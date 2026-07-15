// 계정 발견 딥링크 — 발견 삼각형(기술검토 v2 6장) 3경로를 외부 관리 페이지로 안내.
// 정직 가드: 우리는 계정을 "자동으로 찾아주지" 않는다. 사용자가 각 경로에서 직접 확인한다("확인하러 가기").
//
// R8 게이트 — 아래 URL은 후보다. 특히 kakao·naver의 "연결된 서비스" 딥경로는 로그인 리다이렉트가 있어
//   정확한 최종 경로는 사람 검증 후 확정한다. 배선 구조는 여기서 고정, URL 값만 교체 가능하게 유지.

export type DiscoveryPath = 'provider-linked' | 'self-verify' | 'breach-lookup';

export type DeepLink = {
  id: string;
  label: string; // 버튼/링크 라벨
  description: string; // 어떤 계정을 여기서 확인하는지(안내형)
  href: string; // 후보 URL(R8 검증 대기)
  path: DiscoveryPath;
  provider?: 'google' | 'kakao' | 'naver'; // provider-linked 경로만
};

// 3경로 안내 메타 — 간편가입 / 직접가입 본인인증 / 유출. 각 경로가 서로 다른 사각지대를 보완.
export const DISCOVERY_PATHS: Record<
  DiscoveryPath,
  { title: string; guide: string }
> = {
  'provider-linked': {
    title: '간편가입한 계정',
    guide: '구글·카카오·네이버로 로그인한 서비스는 각 제공사의 “연결된 서비스” 페이지에서 확인할 수 있어요.',
  },
  'self-verify': {
    title: '직접 가입한 국내 계정',
    guide: '본인인증으로 가입한 국내 사이트는 e프라이버시 클린서비스에서 가입 내역을 조회할 수 있어요.',
  },
  'breach-lookup': {
    title: '유출된 계정',
    guide: '내 정보가 어디서 유출됐는지는 KISA “털린 내 정보 찾기”에서 확인할 수 있어요.',
  },
};

export const DEEP_LINKS: DeepLink[] = [
  // provider-linked (간편가입) — 3사 연결된 서비스 관리
  {
    id: 'google-connections',
    label: '구글 연결앱 확인',
    description: '구글 계정에 연결된 외부 서비스 목록',
    href: 'https://myaccount.google.com/connections',
    path: 'provider-linked',
    provider: 'google',
  },
  {
    id: 'kakao-connections',
    label: '카카오 연결서비스 확인',
    description: '카카오계정에 연결된 서비스 목록',
    href: 'https://accounts.kakao.com/weblogin/account/partner',
    path: 'provider-linked',
    provider: 'kakao',
  },
  {
    id: 'naver-connections',
    label: '네이버 연결서비스 확인',
    description: '네이버 내정보의 연결된 서비스 목록',
    href: 'https://nid.naver.com/user2/help/myInfo',
    path: 'provider-linked',
    provider: 'naver',
  },
  // self-verify (직접가입 본인인증)
  {
    id: 'eprivacy-clean',
    label: 'e프라이버시 클린서비스 확인',
    description: '주민번호·휴대폰 본인확인으로 가입한 국내 사이트 내역',
    href: 'https://www.eprivacy.go.kr',
    path: 'self-verify',
  },
  // breach-lookup (유출)
  {
    id: 'kidc-breach',
    label: '털린 내 정보 찾기 확인',
    description: '유출 데이터에 내 계정이 포함됐는지 조회',
    href: 'https://kidc.eprivacy.go.kr',
    path: 'breach-lookup',
  },
];

export function linksByPath(path: DiscoveryPath): DeepLink[] {
  return DEEP_LINKS.filter((l) => l.path === path);
}

// 대표 딥링크(cleanup 등 단일 지점 노출용) — 유출 점검이 정리 전 첫 확인 지점.
export function primaryLink(id: string): DeepLink | undefined {
  return DEEP_LINKS.find((l) => l.id === id);
}
