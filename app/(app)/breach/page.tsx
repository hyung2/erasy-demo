'use client';

import { useEffect, useState } from 'react';
import { ServiceAvatar } from '@/components/ServiceAvatar';
import { BreachPasswordCheck } from '@/components/BreachPasswordCheck';
import type { BreachDTO } from '@/lib/api-types';

const sevLabel = { high: '높음', mid: '중간', low: '낮음' } as const;

export default function BreachPage() {
  const [guideOpen, setGuideOpen] = useState(false);

  // 유출 이력은 **이 사용자 것만** 받는다. 예전에는 dummy-data를 직접 읽어서, 방금 가입한
  // 사람에게도 "Quora 2018-12 유출"이 자기 이력으로 떴다.
  const [breaches, setBreaches] = useState<BreachDTO[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    fetch('/api/guard')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { data: { breaches: BreachDTO[] } }) => {
        setBreaches(body.data.breaches ?? []);
        setLoadState('ready');
      })
      .catch(() => setLoadState('error'));
  }, []);

  const active = breaches.filter((b) => !b.resolved);
  const resolved = breaches.filter((b) => b.resolved);

  return (
    <>
      <div className="page-head">
        <div className="head-left">
          <h1>침해 알림</h1>
          {/* "실시간 감시 중"은 상시 대조 파이프라인이 있을 때 할 말이다. 지금 하는 일은
              아래 비밀번호 검사(HIBP 실조회)와 계정별 유출 이력 표기다. */}
          {active.length > 0 && <span className="badge warn-badge">조치 필요</span>}
        </div>
      </div>

      {/* 요약 — 실제 미해결 건수. 0건이면 경고 대신 다음 걸음을 말한다. */}
      {loadState === 'error' ? (
        <section className="panel" role="status">
          <p className="panel-note">알림을 불러오지 못했어요. 로그인 상태를 확인해 주세요.</p>
        </section>
      ) : loadState === 'ready' && active.length === 0 ? (
        <section className="panel" role="status">
          <div className="alert-body">
            <h2>아직 확인된 유출이 없어요</h2>
            <p className="score-sub">
              유출 이력은 계정을 찾아 대조해야 알 수 있어요. 아래에서 쓰는 비밀번호가 이미
              유출된 적 있는지 지금 바로 검사해 볼 수 있습니다.
            </p>
          </div>
        </section>
      ) : (
        loadState === 'ready' && (
          <section className="panel is-danger alert" role="status">
            <span className="alert-mark" aria-hidden="true" />
            <div className="alert-body">
              <h2>{active.length}개 계정에서 유출 정황이 발견되었습니다</h2>
              <p className="score-sub">아래 계정의 안전 조치를 확인하세요.</p>
            </div>
          </section>
        )
      )}

      {/* 비밀번호 유출 실측 검사 (HIBP range · 점수 무관 독립 시연) */}
      <BreachPasswordCheck />

      {active.length > 0 && (
        <h2 className="section-label">조치가 필요한 항목 {active.length}건</h2>
      )}

      {active.map((b) => (
        <article className="panel breach-card" key={b.id}>
          <ServiceAvatar service={b.service} iconSize={20} />
          <div className="breach-body">
            <div className="breach-head">
              <h4>{b.service}</h4>
              <span className={`risk ${b.severity}`}>{sevLabel[b.severity]}</span>
            </div>
            <p className="breach-date">유출 시점 {b.breachDate}</p>

            <p className="chips-label">유출된 정보</p>
            <div className="chips">
              {b.exposedFields.map((f) => (
                <span className="chip-data" key={f}>
                  {f}
                </span>
              ))}
            </div>

            <p className="advice">{b.advice}</p>
            <button type="button" className="btn btn-secondary" onClick={() => setGuideOpen(true)}>
              조치 방법 보기
            </button>
          </div>
        </article>
      ))}

      {resolved.length > 0 && (
        <>
          <h2 className="section-label">조치 완료된 항목 {resolved.length}건</h2>
          {resolved.map((b) => (
            <article className="panel breach-card resolved" key={b.id}>
              <ServiceAvatar service={b.service} iconSize={20} />
              <div className="breach-body">
                <div className="breach-head">
                  <h4>{b.service}</h4>
                  <span className="resolved-tag">✓ 조치 완료</span>
                </div>
                <p className="breach-date">유출 시점 {b.breachDate}</p>
                <p className="advice">{b.advice}</p>
              </div>
            </article>
          ))}
        </>
      )}

      {/* 안전 조치 가이드 모달 */}
      {guideOpen && (
        <div className="modal" onClick={(e) => e.target === e.currentTarget && setGuideOpen(false)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-guide-title">
            <h3 id="modal-guide-title">안전 조치 가이드</h3>
            <ol>
              <li>해당 서비스에 로그인해 비밀번호를 새로 설정합니다.</li>
              <li>같은 비밀번호를 쓰던 다른 서비스도 함께 변경합니다.</li>
              <li>가능하면 2단계 인증(2FA)을 활성화합니다.</li>
            </ol>
            <p>이레이지는 비밀번호를 대신 변경하지 않습니다. 아래 링크에서 직접 진행하세요.</p>
            <p>
              <a className="link-out" href="https://haveibeenpwned.com" target="_blank" rel="noopener">
                유출 여부 직접 확인하기 ↗
              </a>
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setGuideOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
