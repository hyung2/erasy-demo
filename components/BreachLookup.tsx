'use client';

// 유출 대조 실행 버튼.
//
// 이 화면이 오래도록 말하지 못했던 것: "유출이 없다"와 "아직 안 봤다"의 차이.
// 둘을 같은 문장으로 말하면 아무것도 대조하지 않은 사람에게 안심을 파는 셈이 된다.
// 그래서 대조 전에는 안심시키지 않고, 대조 후에는 언제 봤는지를 함께 남긴다.
import { useState } from 'react';

type ScanResult = {
  found: number;
  created: number;
  linkedToAccount: number;
  services: string[];
};

export function BreachLookup({
  checkedAt,
  onDone,
}: {
  /** 마지막 대조 시각(ISO). null이면 한 번도 하지 않았다. */
  checkedAt: string | null;
  /** 적재가 끝난 뒤 목록·점수를 다시 읽어야 한다. */
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/breach/scan', { method: 'POST' });
      const body = (await res.json()) as
        | { ok: true; data: ScanResult }
        | { ok: false; error: string };
      if (!res.ok || !body.ok) {
        setError('error' in body ? body.error : '대조에 실패했습니다.');
        return;
      }
      setResult(body.data);
      onDone();
    } catch {
      setError('대조 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="card-head">
        <h2 className="card-title">내 이메일이 유출된 적 있는지 대조하기</h2>
      </div>

      <p className="score-sub">
        가입한 이메일 주소가 공개된 유출 사건에 포함됐는지 확인합니다. 비밀번호는 보내지
        않습니다.
      </p>

      {checkedAt && !result && (
        <p className="head-meta">
          마지막 대조 {new Date(checkedAt).toLocaleDateString('ko-KR')}
        </p>
      )}

      <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
        {busy ? '대조하는 중…' : checkedAt ? '다시 대조하기' : '지금 대조하기'}
      </button>

      {error && (
        <p className="status danger" role="alert">
          {error}
        </p>
      )}

      {result && (
        <p className="score-sub" role="status">
          {result.found === 0
            ? '공개된 유출 사건에서 이 주소를 찾지 못했습니다.'
            : result.created === 0
              ? `유출 사건 ${result.found}건을 확인했고, 모두 이미 목록에 있습니다.`
              : `유출 사건 ${result.found}건 중 ${result.created}건을 새로 확인했습니다.` +
                (result.linkedToAccount > 0
                  ? ` 그중 ${result.linkedToAccount}건은 보유 계정과 이어졌습니다.`
                  : '')}
        </p>
      )}
    </section>
  );
}
