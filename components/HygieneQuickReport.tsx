'use client';

// 위생축을 살리는 최소 입력 화면.
//
// 위생축(가중치 0.30)이 재는 것은 비밀번호 재사용과 2단계 인증인데, 그건 **사용자만 아는
// 사실**이다. 우리는 비밀번호를 저장하지 않으므로 서버가 알아낼 방법이 없다.
// 문제는 신고 경로가 계정별 모달뿐이라, 264개를 가진 사용자에게는 사실상 없는 길이었다는
// 것이다(실측 coverage 0). 여기서는 한 화면에서 몇 개를 한꺼번에 넘긴다.
//
// 전부 다 물어보지 않는다. 자주 쓰는 계정 몇 개면 축이 켜지고, 그 사실을 먼저 말한다.
import { useMemo, useState } from 'react';
import type { AccountDTO } from '@/lib/api-types';

/** 한 번에 물어보는 계정 수. 늘리면 입력이 노동이 되고, 줄이면 축이 안 켜진다. */
const ASK_COUNT = 6;

type Row = { id: string; name: string; passwordReused: boolean; twoFactorEnabled: boolean };

export function HygieneQuickReport({
  accounts,
  onDone,
}: {
  accounts: AccountDTO[];
  onDone: () => void;
}) {
  // 자주 쓰는 것부터 묻는다. 방치된 계정의 비밀번호 습관은 기억나지 않고,
  // 기억나지 않는 것을 물으면 사용자는 아무거나 찍는다.
  const candidates = useMemo(
    () =>
      accounts
        .filter((a) => !a.twoFactorEnabled && !a.passwordReused)
        .sort((a, b) => a.lastUsedDays - b.lastUsedDays)
        .slice(0, ASK_COUNT),
    [accounts],
  );

  const [rows, setRows] = useState<Row[]>(() =>
    candidates.map((a) => ({
      id: a.id,
      name: a.name,
      passwordReused: false,
      twoFactorEnabled: false,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ observed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (candidates.length === 0) return null;

  function toggle(id: string, field: 'passwordReused' | 'twoFactorEnabled') {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: !r[field] } : r)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/accounts/self-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: rows }),
      });
      const body = (await res.json()) as
        | { ok: true; data: { updated: number; observed: number } }
        | { ok: false; error: string };
      if (!res.ok || !body.ok) {
        setError('error' in body ? body.error : '저장에 실패했습니다.');
        return;
      }
      setResult({ observed: body.data.observed });
      onDone();
    } catch {
      setError('저장 요청을 보내지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="card-head">
        <h2 className="card-title">비밀번호 습관을 알려주시면 위생 점수를 낼 수 있어요</h2>
      </div>
      <p className="score-sub">
        비밀번호는 저장하지 않기 때문에 이 부분은 저희가 알아낼 수 없습니다. 자주 쓰는 계정
        몇 개만 알려주시면 그 범위에서 계산합니다.
      </p>

      <div className="hygiene-grid">
        <div className="hygiene-head">
          <span>계정</span>
          <span>비밀번호 돌려씀</span>
          <span>2단계 인증</span>
        </div>
        {rows.map((r) => (
          <div className="hygiene-row" key={r.id}>
            <span className="hygiene-name">{r.name}</span>
            <label className="hygiene-cell">
              <input
                type="checkbox"
                checked={r.passwordReused}
                onChange={() => toggle(r.id, 'passwordReused')}
              />
            </label>
            <label className="hygiene-cell">
              <input
                type="checkbox"
                checked={r.twoFactorEnabled}
                onChange={() => toggle(r.id, 'twoFactorEnabled')}
              />
            </label>
          </div>
        ))}
      </div>

      <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
        {busy ? '반영하는 중…' : '알려주기'}
      </button>

      {error && (
        <p className="status danger" role="alert">
          {error}
        </p>
      )}

      {result && (
        <p className="score-sub" role="status">
          {result.observed === 0
            ? '아무 항목도 켜지 않으셨네요. 해당 없음은 “모른다”와 구별할 수 없어 점수에 넣지 않았습니다.'
            : `${result.observed}개 계정의 신호를 반영했습니다. 위생 점수가 이 범위에서 계산됩니다.`}
        </p>
      )}
    </section>
  );
}
