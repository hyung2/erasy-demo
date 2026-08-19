// 계정 하나를 "정리하러 갈 곳"으로 옮기는 경로 해석.
//
// 구현스코프 1장이 F4(연결 해제)·F5(비번 변경)·F6(계정 삭제)·F8(구독 정리)을 전부
// **실 페이지 랜딩**으로 확정했다. 프로그래밍으로 실행할 수 없는 동작은 억지로 흉내내지 않고
// 사용자를 실제 처리 페이지로 보낸다 — "정직하면서도 실제로 처리됨". 수용 기준도 같은 문장이다:
// 액션 클릭 → 실 페이지 이동 → 복귀 후 처리됨 마킹 → 점수 재계산.
//
// 지어내지 않는다
//   cleanup-queue 주석이 경고한 그대로다 — "여기서 URL을 지어내면 사용자를 없는 페이지로 보낸다".
//   서비스별 탈퇴 경로(/settings/delete 류)는 서비스마다 다르고 자주 바뀌며, 기억으로 적으면
//   링크의 절반이 404가 된다. 그래서 두 종류만 쓴다.
//     1) 제공사 연결 관리 페이지 — deep-links의 검증된 URL. **여기서는 실제로 연결이 끊긴다.**
//     2) 서비스 홈 — 카탈로그가 이미 들고 있는 도메인. 탈퇴 버튼 위치까지는 모르지만
//        적어도 맞는 사이트로 보낸다. 카탈로그에 없으면 링크를 만들지 않는다(안내만).
import { CATALOG } from './gmail-catalog';
import { DEEP_LINKS } from './deep-links';

export type CleanupDestination = {
  href: string;
  label: string;
  /** provider = 제공사 연결 관리(실제로 끊김) · site = 서비스 사이트(사용자가 직접 처리) */
  kind: 'provider' | 'site';
  /** 거기서 무엇을 하면 되는지 한 줄. 화면이 그대로 읽어 쓴다. */
  note: string;
};

const PROVIDER_LABEL: Record<string, string> = {
  google: '구글',
  kakao: '카카오',
  naver: '네이버',
};

/** 이름 대조 정규화 — connection-import·gmail 스캔과 같은 규칙. */
const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * 메일 발신 전용 도메인은 웹사이트가 아니다.
 * 카탈로그의 domains는 **메일을 보내는 도메인**이라, `facebookmail.com`처럼 접속할 수 없는
 * 값이 섞여 있다. 그런 주소로 보내면 "정리하러 가기"가 곧장 신뢰를 깎는다.
 */
function isMailOnlyDomain(domain: string): boolean {
  return /(^|\.)(mail|email|mailer|mailing|notification|notify)\./.test(`.${domain}`)
    || /mail\.[a-z]+$/.test(domain);
}

/** 카탈로그가 아는 서비스면 접속 가능한 대표 도메인을 돌려준다. 모르면 null. */
export function siteDomainFor(serviceName: string): string | null {
  const k = key(serviceName);
  const hit = CATALOG.find(
    (e) => key(e.service) === k || (e.aliases ?? []).some((a) => key(a) === k),
  );
  if (!hit) return null;
  return hit.domains.find((d) => !isMailOnlyDomain(d)) ?? null;
}

/**
 * 이 계정을 정리하려면 어디로 가야 하는가.
 *
 * 소셜로 연결한 계정이 먼저다. 제공사 연결 관리 페이지에서는 **실제로 연결이 끊기고**,
 * 끊긴 결과가 목록에서 사라지는 것으로 확인까지 된다(accounts/import의 사라짐 판정).
 * 자체 가입 계정은 그 서비스에서 직접 탈퇴하거나 비밀번호를 바꾸는 수밖에 없다.
 */
export function destinationFor(account: {
  name: string;
  provider: string;
}): CleanupDestination | null {
  const providerLabel = PROVIDER_LABEL[account.provider];
  if (providerLabel) {
    const link = DEEP_LINKS.find(
      (l) => l.path === 'provider-linked' && l.provider === account.provider,
    );
    if (link) {
      return {
        href: link.href,
        label: `${providerLabel} 연결 관리 열기`,
        kind: 'provider',
        note: `${providerLabel} 계정의 연결된 서비스 목록에서 “${account.name}”의 연결을 끊으세요.`,
      };
    }
  }

  const domain = siteDomainFor(account.name);
  if (domain) {
    return {
      href: `https://${domain}`,
      label: `${account.name} 사이트 열기`,
      kind: 'site',
      note: '해당 서비스에서 직접 탈퇴하거나 비밀번호를 바꾸세요. 우리가 대신 하지 않습니다.',
    };
  }

  return null;
}
