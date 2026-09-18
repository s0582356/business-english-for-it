import { describe, expect, it } from 'vitest'
import { validateContentPackage, validateItem } from '../contentValidation.js'

const validChoice = {
  id: 'c1',
  type: 'choice',
  intent: 'telephone-opening',
  category: 'Business Telephoning',
  prompt: 'Which is correct?',
  options: ['A', 'B'],
  correctAnswer: 'A',
  explanation: 'Because A.',
}

const validOrdered = {
  id: 'o1',
  type: 'ordered',
  intent: 'dialog-reconstruction',
  category: 'Business Telephoning',
  prompt: 'Order these steps.',
  steps: [
    { id: 'x', label: 'First' },
    { id: 'y', label: 'Second' },
  ],
  correctOrder: ['x', 'y'],
}

describe('validateItem - choice', () => {
  it('akzeptiert ein gültiges Choice-Item', () => {
    const result = validateItem(validChoice, 0)
    expect(result).toMatchObject({ id: 'c1', type: 'choice', correctAnswer: 'A' })
  })

  it('lehnt ein Choice-Item ohne "prompt" ab', () => {
    const { prompt, ...broken } = validChoice
    expect(() => validateItem(broken, 0)).toThrow(/prompt/)
  })

  it('lehnt ab, wenn "correctAnswer" nicht in "options" enthalten ist', () => {
    const broken = { ...validChoice, correctAnswer: 'Not an option' }
    expect(() => validateItem(broken, 0)).toThrow(/correctAnswer/)
  })

  it('lehnt weniger als zwei Optionen ab', () => {
    const broken = { ...validChoice, options: ['A'] }
    expect(() => validateItem(broken, 0)).toThrow(/options/)
  })

  it('übernimmt ein gültiges memoryHint und lässt leere Felder weg', () => {
    const withHint = { ...validChoice, memoryHint: { whyItFits: 'Weil so.', memoryHook: '' } }
    const result = validateItem(withHint, 0)
    expect(result.memoryHint).toEqual({ whyItFits: 'Weil so.', memoryHook: null })
  })
})

describe('validateItem - ordered', () => {
  it('akzeptiert ein gültiges Ordered-Item', () => {
    const result = validateItem(validOrdered, 0)
    expect(result).toMatchObject({ id: 'o1', type: 'ordered', correctOrder: ['x', 'y'] })
  })

  it('lehnt ab, wenn "correctOrder" keine Permutation der Step-IDs ist', () => {
    const broken = { ...validOrdered, correctOrder: ['x', 'z'] }
    expect(() => validateItem(broken, 0)).toThrow(/correctOrder/)
  })

  it('lehnt doppelte Step-IDs ab', () => {
    const broken = { ...validOrdered, steps: [{ id: 'x', label: 'A' }, { id: 'x', label: 'B' }] }
    expect(() => validateItem(broken, 0)).toThrow(/eindeutig/)
  })

  it('lehnt ungültige stepFeedback-Einträge ab', () => {
    const broken = { ...validOrdered, stepFeedback: { doesNotExist: 'text' } }
    expect(() => validateItem(broken, 0)).toThrow(/stepFeedback/)
  })
})

describe('validateItem - Typprüfung', () => {
  it('lehnt einen nicht unterstützten Typ mit klarer Meldung ab', () => {
    const broken = { ...validChoice, type: 'vocabulary' }
    expect(() => validateItem(broken, 2)).toThrow(/Item 3.*"choice" oder "ordered"/)
  })

})

describe('validateContentPackage', () => {
  it('validiert ein gemischtes Array aus choice und ordered', () => {
    const result = validateContentPackage([validChoice, validOrdered])
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('choice')
    expect(result[1].type).toBe('ordered')
  })

  it('lehnt ein leeres Array ab', () => {
    expect(() => validateContentPackage([])).toThrow(/keine Lern-Items/)
  })

  it('lehnt Nicht-Array-Daten ab', () => {
    expect(() => validateContentPackage({ not: 'an array' })).toThrow(/Array/)
  })
})
