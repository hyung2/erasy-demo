'use client';

// 메일함 기반 계정 발견(T5.6) — 버튼 → 구글 동의 → 1회성 토큰 → 서버 스캔 → 결과.
//
// 정직성 규약(이 컴포넌트가 지켜야 하는 것)
//  - 결과는 "메일 기준 추정"이다. 실제 로그인일이 아님을 결과 옆에 항상 표기한다.
//  - 카탈로그 밖 서비스는 발견되지 않는다. "못 찾은 것"과 "없는 것"을 구분해 보여준다.
//  - 토큰은 이 컴포넌트의 지역 변수로만 존재하다 요청 후 사라진다. state에도 담지 않는다.
import { useState } from 'react';
import type { ScanHit } from '@/lib/gmail-scan';

type ScanData = {
  hits: ScanHit[];
  unmatchedDomains: number;
  /** 개인 메일로 판단해 제외한 건수 — 판별 근거라 화면에도 드러낸다. */
  excludedPersonal: number;
  scanned: number;
  failedQueries: number;
  // ── 개방 모드(A1) ──
  /** 사용한 가입·인증 문구 개수. */
  phraseCount: number;
  /** 질의에 걸린 메일 수. */
  listed: number;
  /** 질의에 더 남았는데 상한·시간에서 멈췄는가 — 잘랐다는 사실을 숨기지 않는다. */
  truncated: boolean;
  maxMessages: number;
  /** 목록에는 있었으나 시간 예산으로 확인하지 못한 건수. */
  skipped: number;
  /** 카탈로그로 이름을 확정하지 못해 도메인으로 담은 건수(사용자 확인 필요량). */
  unnamed: number;
  /** 발송 대행 도메인이라 어느 서비스인지 특정하지 못해 담지 않은 건수. */
  excludedInfra: number;
  infraDomains: string[];
  /** 인벤토리에 새로 추가된 계정 수. */
  discoveredCount: number;
  /** 활동일이 갱신된 기존 계정 수. */
  updatedCount: number;
};

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

// Google Identity Services 최소 타입 — 라이브러리 의존 없이 필요한 표면만 선언한다.
type TokenResponse = { access_token?: string; error?: string };
type TokenClient = { requestAccessToken: () => void };
type GoogleGlobal = {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string;
        scope: string;
        callback: (res: TokenResponse) => void;
        error_callback?: (err: { type?: string }) => void;
      }) => TokenClient;
    };
  };
};

function loadGis(): Promise<GoogleGlobal> {
  const existing = (window as unknown as { google?: GoogleGlobal }).google;
  if (existing?.accounts?.oauth2) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const prior = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const script = prior ?? document.createElement('script');
    const onLoad = () => {
      const g = (window as unknown as { google?: GoogleGlobal }).google;
      if (g?.accounts?.oauth2) resolve(g);
      else reject(new Error('GIS 로드 실패'));
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', () => reject(new Error('GIS 로드 실패')), { once: true });
    if (!prior) {
      script.src = GIS_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export default function GmailScan({ onApplied }: { onApplied?: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScanData | null>(null);
  // 확인 처리 — 성공 시 처리 건수를 담는다. null이면 아직 안 누른 상태.
  const [acked, setAcked] = useState<number | null>(null);
  const [acking, setAcking] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  async function acknowledge() {
    if (acking) return;
    setAcking(true);
    setAckError(null);
    try {
      const res = await fetch('/api/accounts/acknowledge', { method: 'POST' });
      const body = (await res.json()) as { ok: boolean; error?: string; data?: { acknowledged: number } };
      if (!res.ok || !body.ok) {
        setAckError(body.error ?? '확인 처리에 실패했습니다.');
        return;
      }
      setAcked(body.data?.acknowledged ?? 0);
    } catch {
      setAckError('네트워크 오류가 발생했습니다.');
    } finally {
      setAcking(false);
    }
  }

  async function runScan() {
    setError(null);
    setPending(true);

    try {
      const idRes = await fetch('/api/scan/gmail/client-id');
      const idJson = (await idRes.json()) as { ok: boolean; data?: { clientId: string }; error?: string };
      if (!idJson.ok || !idJson.data) {
        setError(idJson.error ?? '메일 스캔을 시작할 수 없습니다.');
        setPending(false);
        return;
      }

      const gis = await loadGis();
      const client = gis.accounts.oauth2.initTokenClient({
        client_id: idJson.data.clientId,
        scope: GMAIL_SCOPE,
        callback: (res) => {
          // 토큰은 여기 지역 변수로만 산다 — state·스토리지에 넣지 않는다.
          if (!res.access_token) {
            setError('메일 접근 권한이 필요합니다.');
            setPending(false);
            return;
          }
          void postScan(res.access_token);
        },
        error_callback: () => {
          setError('권한 창이 닫혔습니다. 다시 시도해 주세요.');
          setPending(false);
        },
      });
      client.requestAccessToken();
    } catch {
      setError('메일 스캔을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      setPending(false);
    }
  }

  async function postScan(accessToken: string) {
    try {
      const res = await fetch('/api/scan/gmail', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessToken }),
      });
      const json = (await res.json()) as { ok: boolean; data?: ScanData; error?: string };
      if (!json.ok || !json.data) {
        setError(json.error ?? '메일함 조회에 실패했습니다.');
        return;
      }
      setData(json.data);
      onApplied?.();
    } catch {
      setError('메일함 조회에 실패했습니다.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="gmail-scan-title">
      <div className="breach-head">
        <h3 id="gmail-scan-title">메일함으로 계정 찾기</h3>
        <span className="badge live">실측</span>
      </div>

      <p className="score-sub">
        가입·인증 메일을 <strong>구글 검색에 맡겨</strong> 골라내고, 그렇게 걸린 메일의{' '}
        <strong>발신자와 날짜만</strong> 받아 서비스를 되짚습니다. 검색은 구글 서버에서 이뤄지므로{' '}
        <strong>메일 내용은 우리 서버로 오지 않고 저장되지도 않습니다</strong>. 권한도 이 조회에만
        쓰이고 보관하지 않습니다. 네이버·카카오처럼 개인 메일 주소로도 쓰이는 도메인은 서비스 알림
        주소에서 온 메일만 셉니다.
      </p>

      {/* 구글 권한 창에 "확인되지 않은 앱" 경고가 뜬다. 아직 구글 앱 검증을 받지 않았기
          때문이고, 민감 권한이라 검증에 몇 주가 걸린다. 미리 말하지 않으면 처음 보는 사람은
          그 화면에서 창을 닫는다 — 놀라서 닫는 것과 알고 넘어가는 것은 다르다. */}
      <div className="consent-notice">
        <p className="consent-notice-title">권한 창에서 경고가 보일 수 있어요</p>
        <p>
          아직 구글 앱 검증을 받지 않아 <strong>&ldquo;Google에서 확인하지 않은 앱&rdquo;</strong>{' '}
          경고가 표시됩니다. 계속하시려면 그 화면에서 <strong>고급</strong> →{' '}
          <strong>Erasy(안전하지 않음)으로 이동</strong>을 눌러 주세요. 요청하는 권한은{' '}
          <strong>메일 읽기 전용</strong>이고, 검색은 구글 서버에서 이뤄져 메일 내용은 우리 서버로
          오지 않습니다.
        </p>
      </div>

      <button type="button" className="btn btn-primary" onClick={runScan} disabled={pending}>
        {pending ? '메일함 확인 중…' : 'Gmail로 계정 찾기'}
      </button>

      {error && (
        <p className="status danger" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}

      {data && (
        <div style={{ marginTop: 16 }}>
          {/* 0건도 결과다. "못 찾았다"로 끝내면 처음 온 사람은 여기서 막힌다 —
              찾지 못한 이유와 다음 걸음을 함께 말한다. */}
          {data.hits.length === 0 ? (
            <p className="status" role="status">
              가입·인증 메일을 찾지 못했습니다. 메일을 지웠거나 다른 주소로 가입했을 수 있어요 —
              계정 목록에서 직접 추가하거나, 소셜 로그인 연결목록을 가져와 채울 수 있습니다.
            </p>
          ) : (
            <p className="status safe" role="status">
              {data.hits.length}개 서비스를 찾았습니다 — 몰랐던 계정 {data.discoveredCount}개 추가 ·
              활동일 {data.updatedCount}개 갱신
            </p>
          )}

          <ul className="scan-hits">
            {data.hits.map((hit) => (
              <li key={hit.service} className="report-row">
                <span>{hit.service}</span>
                <span className="advice">
                  {formatLastSeen(hit.lastSeenDays)} · 메일 기준 추정
                </span>
              </li>
            ))}
          </ul>

          <p className="advice" style={{ marginTop: 12 }}>
            마지막 활동일은 <strong>메일 수신일 기준 추정치</strong>입니다. 실제 로그인 기록이 아니라
            광고 메일만 받아도 최근으로 잡힙니다.
          </p>
          <p className="advice">
            가입·인증 메일 문구 {data.phraseCount}가지로 찾아 <strong>발신 주소로 서비스를 되짚었습니다</strong>
            (메일 {data.listed}건 확인). 정해진 목록에 없는 서비스도 담기지만, 그 문구가 없는
            가입 메일은 여전히 찾지 못합니다 — 못 찾은 것이지 없는 것이 아닙니다.
            {data.truncated &&
              ` 한 번에 ${data.maxMessages}건까지만 훑습니다 — 조건에 맞는 메일이 그보다 많아 나머지는 이번 결과에 빠졌습니다.`}
            {data.skipped > 0 &&
              ` 시간이 모자라 ${data.skipped}건은 확인하지 못했습니다.`}
            {data.failedQueries > 0 && ` 조회 실패 ${data.failedQueries}건은 결과에서 빠졌습니다.`}
          </p>
          {data.unnamed > 0 && (
            <p className="advice">
              {data.unnamed}곳은 서비스 이름을 확정하지 못해 <strong>보낸 도메인 그대로</strong> 담았습니다.
              이름을 지어내지 않습니다 — 목록에서 직접 고쳐 주세요.
            </p>
          )}
          {data.excludedInfra > 0 && (
            <p className="advice">
              메일 발송을 대행하는 주소에서 온 {data.excludedInfra}건은 담지 않았습니다
              {data.infraDomains.length > 0 && ` (${data.infraDomains.slice(0, 3).join(' · ')}${data.infraDomains.length > 3 ? ' 외' : ''})`}
              . 가입한 건 맞지만 <strong>어느 서비스인지 이 주소로는 알 수 없어</strong>, 서로 다른 곳을
              한 줄로 뭉개지 않으려고 뺐습니다.
            </p>
          )}
          {data.excludedPersonal > 0 && (
            <p className="advice">
              개인이 보낸 메일 {data.excludedPersonal}건은 가입 근거에서 제외했습니다. 네이버·카카오는
              개인 메일 주소로도 쓰여, 지인이 보낸 메일을 가입으로 세지 않습니다.
            </p>
          )}
          {data.discoveredCount > 0 && (
            <p className="advice">
              새로 추가한 계정은 <strong>가입 방식 미확인</strong>으로 둡니다. 메일 발신자만으로는
              간편가입인지 이메일 가입인지 알 수 없어 추측하지 않습니다.
            </p>
          )}

          {/* 확인 = S축 "미인지" 인자 해제. 점수가 왜 오르는지 함께 설명해야 게이밍처럼 보이지 않는다. */}
          {data.hits.length > 0 && (
            <div className="ack-box">
              {acked === null ? (
                <>
                  <p className="advice">
                    목록을 확인하셨으면 아래를 눌러 주세요. <strong>&ldquo;모르는 계정이 있다&rdquo;는 위험이
                    사라져 안전도가 오릅니다.</strong> 계정 자체의 위험(오래 방치·유출·비밀번호 습관)은
                    그대로 남아 있고, 그건 정리해야 없어집니다.
                  </p>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={acknowledge}
                    disabled={acking}
                  >
                    {acking ? '확인 처리 중…' : '목록 확인했어요'}
                  </button>
                </>
              ) : (
                <p className="advice">
                  {acked}곳을 확인 처리했습니다. 이제 <strong>모르고 있던 계정</strong>이 아니라
                  <strong> 알고 관리하는 계정</strong>입니다. 대시보드에서 오른 점수를 확인해 보세요.
                </p>
              )}
              {ackError && (
                <p className="status danger" role="alert">
                  {ackError}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function formatLastSeen(days: number): string {
  if (days <= 1) return '어제 이후 활동';
  if (days < 30) return `${days}일 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}
