'use client';

// 회원 탈퇴 패널.
//
// 확인 문구를 손으로 적게 하는 유일한 자리다. 다른 화면에서는 직접 입력을 걷어냈지만
// 여기서는 반대다 — 되돌릴 수 없는 일에서 번거로움은 비용이 아니라 안전장치다.
//
// 지우기 전에 **무엇이 얼마나 지워지는지 숫자로** 보여 준다. 자기 데이터가 얼마나 쌓였는지
// 모르는 채 누르는 버튼은 동의라고 부르기 어렵다.
import { useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';

type Summary = {
  email: string;
  accounts: number;
  breaches: number;
  cleanupRequests: number;
  alerts: number;
  scoreSnapshots: number;
  accessLogs: number;
};

/** 화면에 줄 세울 항목. 0건도 숨기지 않는다 — "없다"도 사실이다. */
function rowsOf(s: Summary): { label: string; count: number }[] {
  return [
    { label: '찾아 둔 계정', count: s.accounts },
    { label: '접속 기록', count: s.accessLogs },
    { label: '유출 이력', count: s.breaches },
    { label: '정리 요청', count: s.cleanupRequests },
    { label: '알림', count: s.alerts },
    { label: '진단 이력', count: s.scoreSnapshots },
  ];
}

export function DeleteAccountPanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/me')
      .then(async (res) => {
        const body = (await res.json()) as
          | { ok: true; data: Summary }
          | { ok: false; error: string };
        if (!alive) return;
        if (!res.ok || !body.ok) {
          // 실패를 빈 화면으로 감추지 않는다. 숫자를 못 읽었으면 못 읽었다고 말하고,
          // 그 상태에서는 삭제 버튼도 열지 않는다.
          setLoadError('error' in body ? body.error : '보관 현황을 불러오지 못했습니다.');
          return;
        }
        setSummary(body.data);
      })
      .catch(() => alive && setLoadError('보관 현황을 불러오지 못했습니다.'));
    return () => {
      alive = false;
    };
  }, []);

  // 화면에서 한 번 거른다. 서버도 같은 검사를 다시 한다 — 이건 실수를 막는 장치이고,
  // 서버 쪽이 화면을 거치지 않는 요청을 막는 장치다.
  const matches =
    summary != null && confirm.trim().toLowerCase() === summary.email.trim().toLowerCase();

  async function run() {
    if (!matches) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/me', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? '탈퇴 처리에 실패했습니다.');
        setBusy(false);
        return;
      }
      // 세션은 JWT라 서버가 데이터를 지워도 쿠키는 그대로 유효하다. 로그아웃시키지 않으면
      // 사용자는 계정이 사라진 채로 앱 안에 남아 401만 반복해서 보게 된다.
      await signOut({ redirectTo: '/' });
    } catch {
      setError('탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      setBusy(false);
    }
  }

  return (
    <section className="panel is-danger">
      <div className="panel-head">
        <div>
          <h3>회원 탈퇴</h3>
          <p className="panel-note">
            보관 중인 정보를 전부 지웁니다. 되돌릴 수 없습니다.
          </p>
        </div>
      </div>

      {loadError && (
        <p className="status danger" role="alert">
          {loadError}
        </p>
      )}

      {summary && (
        <>
          <ul className="delete-summary">
            {rowsOf(summary).map((r) => (
              <li key={r.label}>
                <span>{r.label}</span>
                <strong>{r.count.toLocaleString('ko-KR')}건</strong>
              </li>
            ))}
          </ul>
          <p className="panel-note">
            다시 로그인하시면 아무것도 없는 새 계정으로 시작합니다. 지운 목록은 복구되지
            않습니다.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setConfirm('');
                setError(null);
                setOpen(true);
              }}
            >
              회원 탈퇴
            </button>
          </div>
        </>
      )}

      {open && summary && (
        <div
          className="modal"
          onClick={(e) => e.target === e.currentTarget && !busy && setOpen(false)}
        >
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="del-title">
            <h3 id="del-title">정말 탈퇴하시겠습니까?</h3>
            <p className="modal-note">
              계정 {summary.accounts.toLocaleString('ko-KR')}건을 포함해 보관 중인 정보가 모두
              삭제됩니다. 확인을 위해 아래 이메일 주소를 그대로 입력해 주세요.
            </p>
            <p className="confirm-target">{summary.email}</p>
            <label className="report-row">
              <span className="sr-only">확인을 위한 이메일 주소</span>
              <input
                type="email"
                className="text-input"
                placeholder="이메일 주소"
                value={confirm}
                autoComplete="off"
                disabled={busy}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && (
              <p className="status danger" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!matches || busy}
                onClick={run}
              >
                {busy ? '삭제 중…' : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
