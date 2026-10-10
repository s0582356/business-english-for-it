import { describe, expect, it } from 'vitest'
import { getSpokenTexts, describeSpokenTexts, SPEECH_BLANK, SPEECH_BREAK } from '../audioText.js'
import { choiceItem, gapItem, orderedDialogItem, orderedStructureItem } from './audioTestHelpers.js'

describe('getSpokenTexts - Choice', () => {
  it('Test 5: Frage = prompt', () => {
    expect(getSpokenTexts(choiceItem).question).toBe(choiceItem.prompt)
  })

  it('Test 6: Loesung = correctAnswer', () => {
    expect(getSpokenTexts(choiceItem).solution).toBe(choiceItem.correctAnswer)
  })

  it('Test 7: falsche Optionen, Erklaerung und Merkhilfe sind nie Audio-Ziel', () => {
    const { question, solution } = getSpokenTexts(choiceItem)
    const everythingSpoken = `${question}\n${solution}`
    for (const option of choiceItem.options.filter((option) => option !== choiceItem.correctAnswer)) {
      expect(everythingSpoken).not.toContain(option)
    }
    expect(everythingSpoken).not.toContain('NICHT-VORLESEN')
  })

  it('liefert fuer unvollstaendige Items null statt zu werfen', () => {
    expect(getSpokenTexts({ id: 'x', type: 'choice', correctAnswer: 'A' })).toEqual({ question: null, solution: 'A' })
    expect(getSpokenTexts(null)).toEqual({ question: null, solution: null })
    expect(getSpokenTexts({ type: 'unbekannt', prompt: 'x' })).toEqual({ question: null, solution: null })
  })
})

describe('getSpokenTexts - Gap', () => {
  it('Test 8: Frage hat eine Sprechpause statt "blank" und ohne Anfuehrungszeichen', () => {
    const { question } = getSpokenTexts(gapItem)
    expect(question).toBe(`Complete the fixed phrase: Nice ${SPEECH_BLANK} see you again. How was your trip?`)
    expect(question).not.toMatch(/blank|___|"/i)
  })

  it('Test 9: Loesung ist der rekonstruierte vollstaendige Satz (nur acceptedAnswers[0])', () => {
    expect(getSpokenTexts(gapItem).solution).toBe('Nice to see you again. How was your trip?')
  })

  it('liest den Klammer-Hinweis in der Frage vor, nicht aber in der Loesung', () => {
    const item = { ...gapItem, prompt: 'Complete the question: "How long have you ___ here?" (asking about a period of time)', acceptedAnswers: ['lived', 'worked'] }
    const { question, solution } = getSpokenTexts(item)
    expect(question).toContain('(asking about a period of time)')
    expect(solution).toBe('How long have you lived here?')
  })

  it('Satzanfang-Luecke und mehrere Varianten: es wird acceptedAnswers[0] gesprochen', () => {
    const item = { ...gapItem, prompt: 'Complete the sentence: "___ my view, the plan is too risky." (a marker)', acceptedAnswers: ['In', 'To'] }
    expect(getSpokenTexts(item).solution).toBe('In my view, the plan is too risky.')
  })

  it('ohne Zitat wird der ganze Prompt verwendet und markiert; mehrere Luecken sind nicht rekonstruierbar', () => {
    const noQuote = { ...gapItem, prompt: 'She is rather ___', acceptedAnswers: ['calm'] }
    expect(describeSpokenTexts(noQuote)).toMatchObject({ solution: 'She is rather calm', flags: ['gap-no-quote-fallback'] })
    // Die einleitende Aufgabenanweisung gehoert nicht in den Loesungssatz.
    const withLeadIn = { ...gapItem, prompt: 'Complete the sentence: She dislikes crowds. She is rather ___', acceptedAnswers: ['calm'] }
    expect(describeSpokenTexts(withLeadIn)).toMatchObject({ question: expect.stringContaining('Complete the sentence:'), solution: 'She dislikes crowds. She is rather calm', flags: ['gap-no-quote-fallback'] })
    const twoBlanks = { ...gapItem, prompt: 'Complete: "___ and ___"', acceptedAnswers: ['a'] }
    expect(getSpokenTexts(twoBlanks).solution).toBeNull()
  })
})

describe('getSpokenTexts - Ordered', () => {
  it('Test 10: Dialog-Loesung = Labels in korrekter Reihenfolge mit Dialog-Pausen', () => {
    const { question, solution } = getSpokenTexts({ ...orderedDialogItem, correctOrder: ['b', 'a', 'c'] })
    expect(question).toBe(orderedDialogItem.prompt)
    expect(solution).toBe(['Hi, this is Pat from Accounts.', 'Hello, Support Team, Kim speaking.', 'How may I help you, Pat?'].join(SPEECH_BREAK))
  })

  it('Test 11: Strukturliste hat KEINE Loesungs-Audio, aber eine Frage', () => {
    const { question, solution } = getSpokenTexts(orderedStructureItem)
    expect(question).toBe(orderedStructureItem.prompt)
    expect(solution).toBeNull()
  })

  it('liest weder die gemischten Schritte in der Frage noch stepFeedback/Erklaerung', () => {
    const { question, solution } = getSpokenTexts(orderedDialogItem)
    expect(question).not.toContain('Support Team')
    expect(`${question}${solution}`).not.toContain('NICHT-VORLESEN')
  })
})

describe('getSpokenTexts - Ordered mit Anrede und Gruss', () => {
  const emailLines = {
    ...orderedDialogItem,
    id: 'email-test-02', itemId: 'email-test-02', areaId: 'email-writing',
    prompt: 'Put this short request into the correct order.',
    steps: [
      { id: 'a', label: 'Hi Sam,' },
      { id: 'b', label: 'Could you send me the file when you get a chance?' },
      { id: 'c', label: 'Please feel free to call me. Yours sincerely,' },
    ],
    correctOrder: ['a', 'b', 'c'],
  }

  it('Anrede, Satz und Gruss sind eine sprechbare Satzfolge', () => {
    expect(getSpokenTexts(emailLines).solution).toBe(['Hi Sam,', 'Could you send me the file when you get a chance?', 'Please feel free to call me. Yours sincerely,'].join(SPEECH_BREAK))
  })

  it('beschreibende Labels mit Beispielen bleiben eine Strukturliste ohne Loesungs-Audio', () => {
    const descriptive = {
      ...emailLines,
      steps: [
        { id: 'a', label: "Closing remark (e.g. 'We look forward to hearing from you.')" },
        { id: 'b', label: "Sign-off (e.g. 'Yours sincerely,')" },
        { id: 'c', label: 'Signature (name, position, company)' },
      ],
    }
    expect(getSpokenTexts(descriptive).solution).toBeNull()
  })

  it('Mischfall: eine einzelne beschreibende Zeile verhindert die Loesungs-Audio (nicht raten)', () => {
    const mixed = { ...emailLines, steps: [...emailLines.steps.slice(0, 2), { id: 'c', label: 'Signature (name, position)' }] }
    expect(getSpokenTexts(mixed).solution).toBeNull()
  })
})
