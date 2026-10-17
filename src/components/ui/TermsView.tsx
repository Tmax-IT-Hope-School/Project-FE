import type { TermsDocument } from '@/lib/terms'

interface TermsViewProps {
  terms: TermsDocument
}

/**
 * 약관·동의 안내문 한 편을 보여줍니다. (문구: lib/terms.ts)
 * 가입 화면의 "보기" 팝업과, 약관에 다시 동의하는 팝업(ConsentGate, #512)이 같이 씁니다.
 */
export function TermsView({ terms }: TermsViewProps) {
  return (
    <div className="flex flex-col gap-4 text-sm break-keep text-slate-700">
      <p>{terms.intro}</p>
      {terms.sections.map((section) => (
        <section key={section.title}>
          <h3 className="font-semibold text-slate-900">{section.title}</h3>
          <ul className="mt-1.5 flex list-disc flex-col gap-1.5 pl-5">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-xs text-slate-500">마지막으로 고친 날: {terms.updatedAt}</p>
    </div>
  )
}
