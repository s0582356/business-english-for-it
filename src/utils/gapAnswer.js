// V1 gleicht ausschliesslich explizit erlaubte Schreibvarianten ab.
export function normalizeGapAnswer(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/[\u2018\u2019\u201B]/g, "'").replace(/[.?!]+$/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function isAcceptedGapAnswer(answer, acceptedAnswers) {
  const normalizedAnswer = normalizeGapAnswer(answer)
  return normalizedAnswer !== '' && Array.isArray(acceptedAnswers)
    && acceptedAnswers.some((acceptedAnswer) => normalizeGapAnswer(acceptedAnswer) === normalizedAnswer)
}
