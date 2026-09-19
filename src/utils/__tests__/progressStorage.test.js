import { beforeEach, describe, expect, it } from 'vitest'
import {
  PROGRESS_STORAGE_KEY,
  buildItemKey,
  getAreaItemStatuses,
  getItemStatus,
  getLastPosition,
  recordItemResult,
  resolveResumeTarget,
  saveLastPosition,
} from '../progressStorage.js'

beforeEach(() => {
  window.localStorage.clear()
})

describe('buildItemKey', () => {
  it('baut einen zusammengesetzten Schlüssel aus areaId und itemId', () => {
    expect(buildItemKey('telephoning', 'tel-open-01')).toBe('telephoning::tel-open-01')
  })

  it('liefert null bei fehlenden Angaben', () => {
    expect(buildItemKey('', 'tel-open-01')).toBeNull()
    expect(buildItemKey('telephoning', '')).toBeNull()
  })
})

describe('recordItemResult / getItemStatus - ID-basiertes Modell (kein Fingerprint-Gate)', () => {
  it('speichert und liest den Status über areaId + itemId', () => {
    expect(recordItemResult('telephoning', 'tel-open-01', true)).toBe(true)
    expect(getItemStatus('telephoning', 'tel-open-01')).toMatchObject({ status: 'correct', attempts: 1 })
  })

  it('erhöht attempts bei wiederholter Antwort und aktualisiert den Status auf das letzte Ergebnis', () => {
    recordItemResult('telephoning', 'tel-open-01', false)
    recordItemResult('telephoning', 'tel-open-01', true)
    const entry = getItemStatus('telephoning', 'tel-open-01')
    expect(entry.status).toBe('correct')
    expect(entry.attempts).toBe(2)
  })

  it('hält Items unterschiedlicher Bereiche mit gleicher itemId sauber getrennt', () => {
    recordItemResult('telephoning', 'item-01', true)
    recordItemResult('email-writing', 'item-01', false)
    expect(getItemStatus('telephoning', 'item-01').status).toBe('correct')
    expect(getItemStatus('email-writing', 'item-01').status).toBe('incorrect')
  })

  it('bleibt bei einer neuen Bibliotheksversion für bestehende itemIds erhalten (kein Fingerprint nötig)', () => {
    // Fortschritt wird rein über areaId+itemId gespeichert - ein "neuer Import"
    // (z. B. erweiterte Bibliothek mit denselben + neuen itemIds) aendert
    // nichts an bereits gespeichertem Fortschritt bestehender IDs.
    recordItemResult('telephoning', 'tel-open-01', true)
    // Simulierter Reload mit erweiterter Bibliothek: bestehende ID erneut abgefragt, neue ID ist offen.
    expect(getItemStatus('telephoning', 'tel-open-01')?.status).toBe('correct')
    expect(getItemStatus('telephoning', 'tel-open-99-new')).toBeNull()
  })

  it('verursacht keinen Crash, wenn eine frühere itemId in der aktuellen Bibliothek nicht mehr existiert', () => {
    recordItemResult('telephoning', 'removed-item', true)
    // Die "entfernte" itemId bleibt einfach ein verwaister, harmloser Eintrag.
    expect(() => getAreaItemStatuses('telephoning')).not.toThrow()
    expect(getAreaItemStatuses('telephoning')['removed-item']).toBeTruthy()
  })
})

describe('getAreaItemStatuses', () => {
  it('liefert nur die Einträge des angefragten Bereichs, ohne Bereichspräfix', () => {
    recordItemResult('telephoning', 'a', true)
    recordItemResult('telephoning', 'b', false)
    recordItemResult('email-writing', 'c', true)

    const statuses = getAreaItemStatuses('telephoning')
    expect(Object.keys(statuses).sort()).toEqual(['a', 'b'])
    expect(statuses.a.status).toBe('correct')
  })
})

describe('lastPosition', () => {
  it('speichert und liest die letzte Position pro Bereich', () => {
    const ok = saveLastPosition('telephoning', {
      lessonId: 'telephoning-v1-slice',
      scenarioId: 'telephoning-v1-slice-mixed',
      itemId: 'tel-open-01',
    })
    expect(ok).toBe(true)

    const position = getLastPosition('telephoning')
    expect(position).toMatchObject({
      lessonId: 'telephoning-v1-slice',
      scenarioId: 'telephoning-v1-slice-mixed',
      itemId: 'tel-open-01',
    })
    expect(typeof position.updatedAt).toBe('string')
  })

  it('behält eine Position mit lessonId allein als Lektions-Fallback', () => {
    expect(saveLastPosition('telephoning', { lessonId: 'x' })).toBe(true)
    expect(getLastPosition('telephoning')).toMatchObject({ lessonId: 'x' })
  })

  it('verwirft Positionen ohne lessonId oder mit ungültigen ID-Typen weiterhin', () => {
    expect(saveLastPosition('telephoning', {})).toBe(false)
    expect(saveLastPosition('telephoning', { lessonId: 1 })).toBe(false)
    expect(saveLastPosition('telephoning', { lessonId: 'x', scenarioId: 1 })).toBe(false)
    expect(saveLastPosition('telephoning', { lessonId: 'x', itemId: 1 })).toBe(false)
  })

  it('liefert null für einen Bereich ohne gespeicherte Position', () => {
    expect(getLastPosition('email-writing')).toBeNull()
  })
})

describe('resolveResumeTarget', () => {
  const library = {
    lessons: [{
      lessonId: 'l1', lessonTitle: 'Lesson 1',
      scenarios: [
        { scenarioId: 's1', scenarioTitle: 'Scenario 1', items: [{ id: 'i1' }, { id: 'i2' }] },
      ],
    }],
  }

  it('löst eine vollständig gültige Position exakt auf (Fall B)', () => {
    const target = resolveResumeTarget(library, { lessonId: 'l1', scenarioId: 's1', itemId: 'i2' })
    expect(target).toEqual({ lessonId: 'l1', lessonTitle: 'Lesson 1', scenarioId: 's1', scenarioTitle: 'Scenario 1', itemId: 'i2' })
  })

  it('fällt bei entfernter itemId auf den Szenario-Anfang zurück (Fall C)', () => {
    const target = resolveResumeTarget(library, { lessonId: 'l1', scenarioId: 's1', itemId: 'removed-item' })
    expect(target).toMatchObject({ lessonId: 'l1', scenarioId: 's1', itemId: null })
  })

  it('erhält über den Storage-Pfad eine Position ohne itemId und fällt auf den Szenario-Anfang zurück', () => {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      itemStatus: {},
      lastPosition: {
        telephoning: { lessonId: 'l1', scenarioId: 's1', updatedAt: '2026-09-19T10:00:00.000Z' },
      },
    }))

    const position = getLastPosition('telephoning')
    expect(position).toMatchObject({ lessonId: 'l1', scenarioId: 's1' })
    expect(position).not.toHaveProperty('itemId')
    expect(resolveResumeTarget(library, position)).toMatchObject({ lessonId: 'l1', scenarioId: 's1', itemId: null })
  })

  it('erhält über den Storage-Pfad eine Position nur mit lessonId und fällt auf den Lektions-Anfang zurück', () => {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      itemStatus: {},
      lastPosition: {
        telephoning: { lessonId: 'l1', updatedAt: '2026-09-19T10:00:00.000Z' },
      },
    }))

    const position = getLastPosition('telephoning')
    expect(position).toMatchObject({ lessonId: 'l1' })
    expect(resolveResumeTarget(library, position)).toEqual({ lessonId: 'l1', lessonTitle: 'Lesson 1', scenarioId: null, scenarioTitle: null, itemId: null })
  })

  it('verwirft über den Storage-Pfad eine Position ohne lessonId und nutzt keinen Resume-Zustand', () => {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      itemStatus: {},
      lastPosition: {
        telephoning: { scenarioId: 's1', itemId: 'i1', updatedAt: '2026-09-19T10:00:00.000Z' },
      },
    }))

    expect(getLastPosition('telephoning')).toBeNull()
  })

  it('fällt bei entferntem Szenario auf den Lektions-Anfang zurück, ohne zu crashen (Fall D)', () => {
    const target = resolveResumeTarget(library, { lessonId: 'l1', scenarioId: 'removed-scenario', itemId: 'i1' })
    expect(target).toEqual({ lessonId: 'l1', lessonTitle: 'Lesson 1', scenarioId: null, scenarioTitle: null, itemId: null })
  })

  it('liefert null bei entfernter Lektion, ohne zu crashen (Fall D)', () => {
    expect(resolveResumeTarget(library, { lessonId: 'removed-lesson', scenarioId: 's1', itemId: 'i1' })).toBeNull()
  })

  it('liefert null ohne gespeicherte Position (Fall A)', () => {
    expect(resolveResumeTarget(library, null)).toBeNull()
  })

  it('liefert null ohne geladene Library (fehlende Library, Fall E)', () => {
    expect(resolveResumeTarget(null, { lessonId: 'l1', scenarioId: 's1', itemId: 'i1' })).toBeNull()
  })
})

describe('Private-Content-Safety', () => {
  it('speichert niemals mehr als die erlaubten Metadatenfelder pro Item', () => {
    recordItemResult('telephoning', 'tel-open-01', true)
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    expect(raw).not.toContain('correctAnswer')
    expect(raw).not.toContain('explanation')

    const entry = getItemStatus('telephoning', 'tel-open-01')
    expect(Object.keys(entry).sort()).toEqual(['attempts', 'lastAnsweredAt', 'status'])
  })

  it('ignoriert einen versuchten Fremdfeld-Einschleus-Versuch über saveLastPosition', () => {
    saveLastPosition('telephoning', {
      lessonId: 'l',
      scenarioId: 's',
      itemId: 'i',
      prompt: 'this should never be persisted',
      options: ['a', 'b'],
    })
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    expect(raw).not.toContain('this should never be persisted')
  })

  it('ignoriert eine kaputte/fremde localStorage-Struktur ohne Crash', () => {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, '{"not":"expected"}')
    expect(getItemStatus('telephoning', 'tel-open-01')).toBeNull()
    expect(() => recordItemResult('telephoning', 'tel-open-01', true)).not.toThrow()
  })
})
