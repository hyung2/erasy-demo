'use client';

// 내 비밀번호 유출 검사 — HIBP 무료 range API 실측 시연(T5.1).
// 입력값은 저장·전송·로깅하지 않는다. 브라우저에서 SHA-1 해시 후 앞 5자만 조회(lib/hibp).
// 안전도 점수와 무관한 독립 기능("실측 증명") — 점수 SSOT는 시드 Breach.
import { useState } from 'react';
import { checkPasswordPwned, type PwnedResult } from '@/lib/hibp';

// 입력은 테마 .text-input 클래스 재사용(다크 배경 위 가독·placeholder·caret 정합).
//   기존 흰 배경 + 상속 흰 글씨로 타이핑이 안 보이던 버그 수정. flex 레이아웃만 인라인 보강.
const inputStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; result: PwnedResult }
  | { kind: 'error' };

export function BreachPasswordCheck() {
  const [value, setValue] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value) return;
    setState({ kind: 'loading' });
    try {
      const result = await checkPasswordPwned(value);
      setState({ kind: 'done', result });
    } catch {
      setState({ kind: 'error' });
    }
  }

  return (
    <>
      <h2 className="section-label">내 비밀번호 유출 검사</h2>
      <section className="panel" aria-labelledby="pw-check-title">
        <div className="breach-head">
          <h4 id="pw-check-title">지금 이 비밀번호, 실제로 유출됐을까요?</h4>
          <span className="badge live">실측</span>
        </div>
        <p className="score-sub">
          입력한 비밀번호가 실제 유출 데이터베이스(Have I Been Pwned)에 있는지 실시간으로 대조합니다.
        </p>

        <form onSubmit={onSubmit} style={{ display: 'flex', gap: 10, margin: '14px 0 4px' }}>
          <input
            type="password"
            className="text-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (state.kind !== 'idle') setState({ kind: 'idle' });
            }}
            placeholder="검사할 비밀번호를 입력하세요"
            aria-label="검사할 비밀번호"
            autoComplete="off"
            spellCheck={false}
            style={inputStyle}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!value || state.kind === 'loading'}
          >
            {state.kind === 'loading' ? '대조 중…' : '유출 검사'}
          </button>
        </form>

        {state.kind === 'done' && state.result.pwned && (
          <p className="status danger" role="status" style={{ marginTop: 12 }}>
            이 비밀번호는 {state.result.count.toLocaleString('ko-KR')}회 유출 확인 — 사용 중이라면 즉시 교체하세요
          </p>
        )}
        {state.kind === 'done' && !state.result.pwned && (
          <p className="status safe" role="status" style={{ marginTop: 12 }}>
            유출 이력 없음 — 알려진 유출 목록에서 발견되지 않았습니다
          </p>
        )}
        {state.kind === 'error' && (
          <p className="advice" role="status" style={{ marginTop: 12 }}>
            일시적으로 대조에 실패했습니다. 잠시 후 다시 시도해 주세요.
          </p>
        )}

        <p className="advice" style={{ marginTop: 14 }}>
          입력한 비밀번호는 저장·전송·로깅하지 않습니다. 브라우저에서 암호화 해시(SHA-1)한 뒤
          앞 5자만 조회하는 방식(k-익명성)이라 원문은 어디에도 전달되지 않습니다. 이 검사 결과는
          안전도 점수에 반영되지 않습니다.
        </p>
      </section>
    </>
  );
}
