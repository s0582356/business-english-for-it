import { describe, expect, it } from 'vitest'
import { validateItem } from '../contentValidation.js'
import { isAcceptedGapAnswer, normalizeGapAnswer } from '../gapAnswer.js'

const gap = { id: 'g1', type: 'gap', intent: 'polite-request', prompt: 'Synthetic prompt.', acceptedAnswers: ['Please send the file', "don't forget"], explanation: 'Synthetic explanation.' }

describe('gap validation and normalization', () => {
  it('accepts valid gap and rejects malformed fields', () => {
    expect(validateItem(gap, 0)).toMatchObject({ type: 'gap', id: 'g1' })
    expect(() => validateItem({ ...gap, acceptedAnswers: [] }, 0)).toThrow(/acceptedAnswers/)
    expect(() => validateItem({ ...gap, acceptedAnswers: [''] }, 0)).toThrow(/acceptedAnswers/)
    const { prompt, ...missingPrompt } = gap
    expect(() => validateItem(missingPrompt, 0)).toThrow(/prompt/)
  })
  it('normalizes whitespace, case, apostrophes and final punctuation only', () => {
    expect(isAcceptedGapAnswer('  please   send the file. ', gap.acceptedAnswers)).toBe(true)
    expect(normalizeGapAnswer('don’t forget')).toBe(normalizeGapAnswer("don't forget"))
    expect(isAcceptedGapAnswer('Please send another file', gap.acceptedAnswers)).toBe(false)
  })
})
