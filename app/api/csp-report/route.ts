// POST /api/csp-report — CSP 위반 보고 수집.
//
// Report-Only 단계에서 무엇이 막힐지 실제로 보기 위한 창구다. 브라우저 콘솔만 보고
// 판단하면 우리가 열어 본 화면에서만 확인되는데, 정작 무서운 것은 **우리가 안 밟은 경로**다.
// 서버 로그로 모으면 심사위원이 밟은 길도 남는다.
//
// 인증을 걸지 않는다. 위반은 로그인 전 화면(랜딩·OAuth 왕복)에서도 나고, 그 구간이
// 오히려 위험하다. 대신 아무것도 저장하지 않고 로그로만 남긴다.
export const dynamic = 'force-dynamic';

/** 보고 본문에서 우리가 볼 부분만. 브라우저마다 조금씩 다르게 보낸다. */
type CspReport = {
  'csp-report'?: {
    'document-uri'?: string;
    'violated-directive'?: string;
    'effective-directive'?: string;
    'blocked-uri'?: string;
  };
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as CspReport | null;
    const r = body?.['csp-report'];
    if (r) {
      // 한 줄로 남긴다. 무엇이(directive) 무엇을(blocked) 어디서(document) 막았는지면 충분하고,
      // 그 이상은 사용자가 방문한 경로 기록이 되어 남길 이유가 없다.
      console.warn(
        '[csp] violation',
        JSON.stringify({
          directive: r['effective-directive'] ?? r['violated-directive'],
          blocked: r['blocked-uri'],
          document: r['document-uri'],
        }),
      );
    }
  } catch {
    // 보고 수집이 실패해도 사용자 화면에 영향을 주지 않는다.
  }
  // 브라우저는 응답 본문을 쓰지 않는다.
  return new Response(null, { status: 204 });
}
