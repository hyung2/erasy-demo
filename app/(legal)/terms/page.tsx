// 이용약관.
// 방침과 같은 규율: 코드가 실제로 하는 일의 범위 안에서만 약속한다.
// 특히 "대신 해제·탈퇴하지 않는다"는 제품의 핵심 경계라 화면 카피와 여기가 어긋나면 안 된다
// (app/(app)/cleanup/page.tsx·scan/page.tsx의 같은 문장과 함께 움직일 것).
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '이용약관 — 이레이지(Erasy)',
  description: '이레이지 서비스의 이용 조건, 이용자와 서비스의 역할 경계, 책임의 한계를 정리한 문서입니다.',
};

const LAST_UPDATED = '2026년 8월 21일';

export default function TermsPage() {
  return (
    <article className="legal-doc">
      <header className="legal-doc-head">
        <h1>이용약관</h1>
        <p className="legal-updated">최종 개정 {LAST_UPDATED}</p>
      </header>

      <section className="legal-section">
        <h2>1. 서비스의 성격</h2>
        <p>
          이레이지(Erasy)는 흩어진 온라인 계정을 한 화면에 모아 보고, 어디가 위험한지 진단하고,
          정리할 곳으로 안내하는 서비스입니다. 현재 초기 단계이며 기능과 화면이 예고 없이 바뀔
          수 있습니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>2. 계정</h2>
        <ul className="legal-list">
          <li>이메일과 비밀번호로 가입하거나 구글 계정으로 로그인할 수 있습니다.</li>
          <li>
            이용자는 자신의 로그인 정보를 관리할 책임이 있습니다. 이레이지 계정의 비밀번호는
            해시로만 보관하므로 운영자도 원문을 알 수 없습니다.
          </li>
          <li>본인의 계정 정보만 등록해야 하며, 타인의 정보를 등록해서는 안 됩니다.</li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>3. 서비스가 하지 않는 일</h2>
        <p>
          아래는 이레이지의 설계상 경계입니다. 편의를 위해서라도 넘지 않습니다.
        </p>
        <ul className="legal-list">
          <li>
            <strong>이용자를 대신해 다른 서비스의 계정을 해제하거나 탈퇴시키지 않습니다.</strong>{' '}
            이레이지는 정리할 곳으로 가는 길을 안내하고, 실제 조치는 이용자가 각 서비스에서 직접
            합니다.
          </li>
          <li>
            <strong>이용자를 대신해 다른 서비스에 로그인하지 않습니다.</strong> 계정 위임이나
            대리 로그인 방식은 채택하지 않았습니다.
          </li>
          <li>
            <strong>다른 서비스의 비밀번호를 저장하지 않습니다.</strong>
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>4. 브라우저 확장</h2>
        <p>
          확장은 이용자가 이미 로그인해 둔 세션으로 연결된 서비스의 이름을 읽어 옵니다. 설치와
          실행은 이용자의 선택이며, 확장 없이도 화면에서 직접 붙여넣거나 계정을 추가할 수
          있습니다. 각 제공사의 화면 구조가 바뀌면 목록을 읽지 못할 수 있고, 그 경우 서비스는
          실패한 사실을 그대로 알립니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>5. 진단 결과의 한계</h2>
        <ul className="legal-list">
          <li>
            안전도 점수는 확보한 신호로 계산한 <strong>참고값</strong>이며, 계정의 실제 안전을
            보장하지 않습니다.
          </li>
          <li>
            재지 못한 항목은 점수를 올려 주는 대신 &ldquo;측정하지 못했다&rdquo;고 표시합니다.
            점수가 높다는 것이 위험이 없다는 뜻은 아닙니다.
          </li>
          <li>
            유출 정보와 도메인 정보는 외부 데이터를 조회한 결과이며, 그 데이터의 정확성과
            최신성은 해당 제공처에 따릅니다.
          </li>
          <li>
            발견된 계정 목록이 이용자의 모든 계정을 뜻하지는 않습니다. 서비스는 찾은 범위를
            화면에 함께 표시합니다.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>6. 금지되는 이용</h2>
        <ul className="legal-list">
          <li>타인의 계정 정보를 등록하거나 타인의 세션으로 확장을 실행하는 행위</li>
          <li>서비스를 자동화 수단으로 과도하게 호출해 운영을 방해하는 행위</li>
          <li>서비스나 연동 대상의 보안 조치를 우회하려는 행위</li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>7. 서비스의 변경과 중단</h2>
        <p>
          운영자는 서비스의 전부 또는 일부를 변경하거나 중단할 수 있습니다. 이용자의 데이터에
          영향을 주는 중단이 예정된 경우 가능한 범위에서 미리 알립니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>8. 책임의 한계</h2>
        <p>
          이레이지는 진단과 안내를 제공할 뿐 이용자의 계정 정리 결과나 외부 서비스에서 발생한
          손해에 대해 책임지지 않습니다. 다만 운영자의 고의 또는 중대한 과실로 인한 손해는 그러하지
          않습니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>9. 개인정보</h2>
        <p>
          개인정보의 처리에 관한 사항은 <a href="/privacy">개인정보처리방침</a>에 따릅니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>10. 준거법</h2>
        <p>이 약관은 대한민국 법에 따라 해석됩니다.</p>
      </section>
    </article>
  );
}
