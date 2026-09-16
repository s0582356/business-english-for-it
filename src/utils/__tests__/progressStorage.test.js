import { beforeEach, describe, expect, it } from 'vitest'
import {
  PROGRESS_STORAGE_KEY,
  deleteRunSummary,
  getRunSummary,
  listRunSummaries,
  saveRunSummary,
} from '../progressStorage.js'

const validFingerprint = 'a'.repeat(64)
const validSummary = {
  fileName: 'telephoning-sample.json',
  itemCount: 13,
  score: 10,
  incorrectItemIds: ['tel-open-01', 'tel-closing-01'],
  completedAt: '2026-09-16T10:00:00.000Z',
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('progressStorage', () => {
  it('speichert und liest eine gültige Zusammenfassung über den Fingerprint', () => {
    expect(saveRunSummary(validFingerprint, validSummary)).toBe(true)
    expect(getRunSummary(validFingerprint)).toEqual(validSummary)
  })

  it('lehnt einen ungültigen Fingerprint ab', () => {
    expect(saveRunSummary('not-a-sha256', validSummary)).toBe(false)
    expect(getRunSummary('not-a-sha256')).toBeNull()
  })

  it('speichert niemals mehr als die erlaubten Metadatenfelder (Private-Content-Safety)', () => {
    const withExtraContent = {
      ...validSummary,
      privateQuestionText: 'This is Laura Kim from Nordwind Software.',
      rawItems: [{ prompt: 'secret private content' }],
    }
    saveRunSummary(validFingerprint, withExtraContent)

    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    expect(raw).not.toContain('secret private content')
    expect(raw).not.toContain('privateQuestionText')

    const stored = getRunSummary(validFingerprint)
    expect(Object.keys(stored).sort()).toEqual(
      ['completedAt', 'fileName', 'incorrectItemIds', 'itemCount', 'score'].sort(),
    )
  })

  it('ignoriert eine unvollständige/kaputte Zusammenfassung', () => {
    expect(saveRunSummary(validFingerprint, { fileName: 'x.json' })).toBe(false)
  })

  it('listet gespeicherte Zusammenfassungen neueste zuerst', () => {
    const otherFingerprint = 'b'.repeat(64)
    saveRunSummary(validFingerprint, { ...validSummary, completedAt: '2026-09-16T08:00:00.000Z' })
    saveRunSummary(otherFingerprint, { ...validSummary, completedAt: '2026-09-16T12:00:00.000Z' })

    const list = listRunSummaries()
    expect(list[0].fingerprint).toBe(otherFingerprint)
    expect(list[1].fingerprint).toBe(validFingerprint)
  })

  it('löscht eine gespeicherte Zusammenfassung', () => {
    saveRunSummary(validFingerprint, validSummary)
    expect(deleteRunSummary(validFingerprint)).toBe(true)
    expect(getRunSummary(validFingerprint)).toBeNull()
  })
})
