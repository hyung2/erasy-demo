// 화면 끝에 놓는 "다음 걸음" — 5단계 흐름을 끊기지 않게 잇는다.
//
// 왜 필요한가: 원페이저 v3의 사용 흐름은 연결 → 확인 → 지우기 → 점수 변화 → 관리의 5단계이고,
// 구현스코프 2장이 그걸 화면에 배선해 뒀다. 화면은 다 만들어졌는데 **다음 화면으로 가는 길이
// 사이드바 메뉴뿐**이었다. 메뉴는 목적지 목록이지 순서가 아니라서, 처음 들어온 사람은
// 계정 목록을 보고 나서 무엇을 해야 하는지 알 수 없다(2026-08-19 실측).
//
// 단계 번호를 함께 적는 이유: 지금 어디쯤인지 알면 남은 걸음도 짐작이 된다. 진행 막대를
// 따로 두는 대신 다음 걸음 하나에 위치를 얹는다 — 화면당 메시지 하나라는 G0 원칙을 지킨다.
import Link from 'next/link';

export const FLOW_TOTAL = 5;

export default function NextStep({
  step,
  title,
  label,
  note,
  href,
}: {
  /** 이동해 갈 단계 번호(1~5). 지금 화면이 아니라 **다음** 화면의 번호다. */
  step: number;
  /** 다음 단계의 이름 — 원페이저 5단계 표기를 그대로 쓴다. */
  title: string;
  /** 버튼에 적히는 행동. */
  label: string;
  /** 왜 그리로 가는지 한 줄. */
  note: string;
  href: string;
}) {
  return (
    <section className="next-step" aria-label="다음 걸음">
      <div className="next-step-body">
        <span className="next-step-eyebrow">
          다음 · {step}/{FLOW_TOTAL}단계 {title}
        </span>
        <p className="next-step-note">{note}</p>
      </div>
      <Link href={href} className="btn btn-primary">
        {label}
      </Link>
    </section>
  );
}
