/**
 * 문제 글을 "보통 글" 과 "수식($...$)" 조각으로 나눕니다. 화면은 수식 조각만 KaTeX 로 그립니다.
 * (React 없이 도는 순수 함수라 lib/ 에 둡니다)
 *
 *   splitMathText('근 $x^2$ 의 값')  -> [{ math: false, text: '근 ' }, { math: true, text: 'x^2' }, { math: false, text: ' 의 값' }]
 *   splitMathText('가격은 $5')        -> [{ math: false, text: '가격은 $5' }]   (닫는 $ 가 없으면 글자 그대로)
 *   splitMathText('')                  -> []
 */
export interface MathPart {
  /** true 면 LaTeX 수식, false 면 보통 글 */
  math: boolean
  text: string
}

export function splitMathText(text: string): MathPart[] {
  const parts: MathPart[] = []
  let rest = text
  while (rest.length > 0) {
    const open = rest.indexOf('$')
    const close = open === -1 ? -1 : rest.indexOf('$', open + 1)
    // 여는 $ 와 닫는 $ 가 둘 다 있어야 수식입니다.
    if (open === -1 || close === -1) {
      parts.push({ math: false, text: rest })
      break
    }
    if (open > 0) parts.push({ math: false, text: rest.slice(0, open) })
    const formula = rest.slice(open + 1, close)
    if (formula.trim() !== '') parts.push({ math: true, text: formula })
    rest = rest.slice(close + 1)
  }
  return parts
}
