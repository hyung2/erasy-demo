// 개인정보처리방침.
//
// 이 문서의 규율: **코드에 있는 것만 적는다.**
//   구현하지 않은 처리를 "예정"으로도 쓰지 않는다(구현 전 문구 약속 금지 — 08-05 학습).
//   반대로 코드가 실제로 보내는 곳은 하나도 빠뜨리지 않는다. 처리 경로가 바뀌면
//   이 파일과 lib/의 호출부는 같이 움직여야 한다.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '개인정보처리방침 — 이레이지(Erasy)',
  description:
    '이레이지가 수집하는 항목, 수집하지 않는 항목, 외부로 나가는 데이터와 그 이유를 정리한 문서입니다.',
};

// 방침 본문을 고칠 때 함께 올린다. 개정일이 실제와 어긋나면 이용자는 언제 무엇이 바뀌었는지
// 알 수 없고, 그 자체가 방침의 신뢰를 깎는다.
const LAST_UPDATED = '2026년 8월 24일';
/** 방침 문의처. 웹스토어 등록 시 개발자 연락처와 같은 값을 쓴다. */
const CONTACT_EMAIL = 'jh_park@jiran.com';

export default function PrivacyPage() {
  return (
    <article className="legal-doc">
      <header className="legal-doc-head">
        <h1>개인정보처리방침</h1>
        <p className="legal-updated">최종 개정 {LAST_UPDATED}</p>
      </header>

      <section className="legal-summary">
        <h2>먼저 요약합니다</h2>
        <ul>
          <li>
            <strong>다른 서비스의 비밀번호를 저장하지 않습니다.</strong> 원문도, 해시도
            보관하지 않습니다. 같은 비밀번호를 여러 곳에 쓰는지 여부만 참/거짓으로 기록합니다.
          </li>
          <li>
            <strong>메일 본문을 읽지 않습니다.</strong> 메일함 스캔은 발신자 주소와 날짜만
            받습니다. 본문은 요청 자체를 하지 않습니다.
          </li>
          <li>
            <strong>브라우저 확장은 우리 서버를 거치지 않습니다.</strong> 이용자 브라우저 안에서
            연결된 서비스의 <em>이름만</em> 읽습니다.
          </li>
          <li>
            <strong>계정을 대신 지우거나 해제하지 않습니다.</strong> 정리는 이용자가 각
            서비스에서 직접 합니다.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>1. 수집하는 항목</h2>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th>구분</th>
                <th>항목</th>
                <th>수집 시점</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>회원 정보</td>
                <td>이메일 주소, 이름(선택), 비밀번호 해시</td>
                <td>가입 시</td>
              </tr>
              <tr>
                <td>구글 로그인</td>
                <td>이름, 이메일 주소</td>
                <td>구글 계정으로 로그인할 때</td>
              </tr>
              <tr>
                <td>계정 목록</td>
                <td>
                  서비스 이름 또는 도메인, 연결 제공사, 분류, 발견 출처, 마지막 사용 추정일,
                  2단계 인증 사용 여부, 비밀번호 재사용 여부(참/거짓), 위험 표시
                </td>
                <td>메일함 스캔·확장 가져오기·직접 입력</td>
              </tr>
              <tr>
                <td>유출 이력</td>
                <td>유출된 서비스명, 유출 시점, 노출 항목, 심각도, 조치 완료 여부</td>
                <td>유출 정보가 확인될 때</td>
              </tr>
              <tr>
                <td>정리 요청</td>
                <td>대상 계정, 조치 유형(연결 해제 / 탈퇴), 진행 상태</td>
                <td>정리 목록에 담을 때</td>
              </tr>
              <tr>
                <td>진단 이력</td>
                <td>안전도 점수, 확인된 계정 비율, 진단 축별 값</td>
                <td>점수를 계산할 때</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="legal-section">
        <h2>2. 수집하지 않는 항목</h2>
        <p>
          아래는 기술적으로 가능하지만 의도적으로 받지 않기로 한 것들입니다. 서비스 설계
          단계에서 배제했습니다.
        </p>
        <ul className="legal-list">
          <li>
            <strong>다른 서비스의 비밀번호</strong> — 원문과 해시 모두. 재사용 여부는 참/거짓
            값만 남고, 어떤 비밀번호였는지는 저장 구조상 복원할 수 없습니다.
          </li>
          <li>
            <strong>메일 본문</strong> — 메일함 스캔은 헤더(발신자·날짜)만 요청합니다.
          </li>
          <li>
            <strong>다른 서비스의 로그인 자격증명</strong> — 이레이지는 이용자를 대신해 다른
            서비스에 로그인하지 않습니다.
          </li>
          <li>
            <strong>연결 목록의 인증 토큰·계정 식별자</strong> — 확장은 서비스 이름 문자열만
            읽습니다.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>3. 외부로 나가는 데이터</h2>
        <p>
          이레이지가 외부에 요청을 보내는 곳은 아래가 전부입니다. 무엇이 나가고 무엇이 나가지
          않는지 함께 적습니다.
        </p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th>전송처</th>
                <th>나가는 것</th>
                <th>이유</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Google (Gmail API)</td>
                <td>
                  검색 조건과 이용자의 접근 권한. <strong>본문은 요청하지 않습니다.</strong>{' '}
                  받는 것은 발신자 주소와 날짜뿐입니다.
                </td>
                <td>가입·인증 메일에서 계정을 찾기 위해</td>
              </tr>
              <tr>
                <td>Have I Been Pwned (Pwned Passwords)</td>
                <td>
                  비밀번호를 브라우저에서 해시로 바꾼 뒤 그 <strong>앞 다섯 글자만</strong>{' '}
                  보냅니다. 비밀번호 원문과 전체 해시는 이레이지 서버를 포함해 어디로도 나가지
                  않습니다.
                </td>
                <td>이미 유출된 비밀번호인지 대조하기 위해</td>
              </tr>
              <tr>
                <td>KISA (공공데이터 WHOIS)</td>
                <td>조회 대상 도메인 이름</td>
                <td>서비스가 아직 운영 중인지 확인하기 위해</td>
              </tr>
              <tr>
                <td>Vercel · Neon</td>
                <td>서비스 운영을 위한 저장·호스팅</td>
                <td>화면 제공과 데이터 보관</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="legal-note">
          이레이지는 수집한 정보를 광고·마케팅 목적으로 제3자에게 제공하거나 판매하지 않습니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>4. 브라우저 확장이 하는 일</h2>
        <p>
          구글·카카오·네이버는 &ldquo;연결된 서비스&rdquo; 목록을 외부 API로 열지 않습니다.
          그래서 이레이지 서버가 물어볼 곳이 없고, 남는 방법은 이용자가 화면에서 복사해
          붙여넣거나 이용자 브라우저가 자기 화면을 읽는 것뿐입니다. 확장은 후자입니다.
        </p>
        <ul className="legal-list">
          <li>
            이용자가 <strong>이미 로그인해 둔 세션</strong>으로 해당 목록 페이지를 배경 탭에서
            열고, 서비스 이름을 읽은 뒤 곧바로 닫습니다.
          </li>
          <li>
            이 과정에 <strong>이레이지 서버는 개입하지 않습니다.</strong> 읽은 이름은 브라우저
            안에서 화면으로 전달되고, 이용자가 확인한 뒤에야 저장됩니다.
          </li>
          <li>
            아이디·비밀번호를 다루지 않으며, 대신 로그인하지 않습니다.
          </li>
          <li>
            확장이 접근하는 주소는 구글·카카오·네이버의 연결 관리 페이지와 이레이지 화면으로
            한정됩니다.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>5. 통계 목적 이용</h2>
        <p>
          어떤 서비스를 몇 명이 쓰는지 <strong>서비스 단위로</strong> 집계합니다. 유출 사건이
          확인됐을 때 같은 서비스를 쓰는 분들께 알리고, 어떤 서비스를 먼저 지원할지 정하는 데
          씁니다.
        </p>
        <ul className="legal-list">
          <li>
            <strong>이용자가 5명 미만인 서비스는 집계에서 제외합니다.</strong> 사람이 적은
            서비스는 숫자 자체가 특정 개인을 가리키기 때문입니다.
          </li>
          <li>
            집계 결과에는 누가 어디에 가입했는지가 들어가지 않습니다. 이용자를 지목하는 형태로
            저장하거나 가공하지 않습니다.
          </li>
          <li>집계에 쓰는 것은 서비스 이름과 이용자 수뿐이며, 외부에 제공하지 않습니다.</li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>6. 보관과 파기</h2>
        <ul className="legal-list">
          <li>수집한 정보는 이용자가 서비스를 이용하는 동안 보관합니다.</li>
          <li>
            회원 정보가 삭제되면 그에 딸린 계정 목록·유출 이력·정리 요청·진단 이력이 함께
            삭제됩니다.
          </li>
          <li>
            <strong>
              설정 화면에서 직접 탈퇴할 수 있습니다.
            </strong>{' '}
            탈퇴하면 회원 정보와 위에 적은 항목이 <strong>그 자리에서</strong> 삭제되며,
            따로 보관하는 사본은 없습니다. 되돌릴 수 없습니다.
          </li>
          <li>
            서비스 이름과 도메인만 담긴 공용 목록은 남습니다. 그 목록에는 누가 어디에
            가입했는지가 들어 있지 않아 특정 개인과 연결되지 않습니다.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>7. 이용자의 권리</h2>
        <p>
          이용자는 자신의 정보에 대해 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다. 계정
          목록은 화면에서 직접 수정하거나 지울 수 있고, 전체 삭제는 설정 화면의 회원 탈퇴로
          이용자가 직접 실행합니다. 그 밖의 요청은 문의 경로로 접수합니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>8. 서비스의 현재 단계</h2>
        <p>
          이레이지는 시연을 위해 만들어진 초기 단계 서비스입니다. 안전도 점수는 확보한 신호로
          계산한 <strong>진단 참고값</strong>이며, 재지 못한 항목은 점수를 올려 주는 대신
          &ldquo;측정하지 못했다&rdquo;고 화면에 표시합니다.
        </p>
      </section>

      <section className="legal-section">
        <h2>9. 문의</h2>
        <p>
          개인정보 처리에 관한 문의와 열람·정정·삭제 요청은 아래로 연락해 주십시오.
        </p>
        <p>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </section>
    </article>
  );
}
