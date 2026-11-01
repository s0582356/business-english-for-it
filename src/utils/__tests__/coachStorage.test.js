import { beforeEach, describe, expect, it } from 'vitest'
import {
  COACH_STORAGE_KEY, COACH_UNREADABLE_KEY, completeCoachUnit, getCoachUnitState, getUnitStepOverview,
  isReviewDue, nextReviewState, resetCoachPosition, saveCoachPosition, saveCoachStepResult,
} from '../coachStorage.js'
import { PROGRESS_STORAGE_KEY, getItemStatus, recordItemResult } from '../progressStorage.js'
import { validateCoachLibrary } from '../coachLibrary.js'
import { coachLibraryData, withStep } from './coachTestHelpers.js'

const DAY = 24 * 60 * 60 * 1000
const library = () => validateCoachLibrary(coachLibraryData())
const unitOf = (lib) => lib.units[0]
const stepOf = (lib, id) => unitOf(lib).steps.find((step) => step.stepId === id)

beforeEach(() => window.localStorage.clear())

describe('Coach-Fortschritt: eigener Speicher, nur Metadaten', () => {
  it('nutzt einen eigenen Schluessel und beruehrt den Quiz-Fortschritt nie', () => {
    recordItemResult('w3-unterricht', 'w3u-cond-001', true)
    const quizBefore = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    const lib = library()
    saveCoachPosition('u1', 't-choice')
    saveCoachStepResult('u1', stepOf(lib, 't-choice'), 'correct')
    completeCoachUnit('u1', { hadTrouble: false })
    expect(window.localStorage.getItem(PROGRESS_STORAGE_KEY)).toBe(quizBefore)
    expect(getItemStatus('w3-unterricht', 'w3u-cond-001')).toMatchObject({ status: 'correct', attempts: 1 })
    expect(window.localStorage.getItem(COACH_STORAGE_KEY)).not.toBeNull()
    expect(getItemStatus('w3-lerncoach', 't-choice')).toBeNull()
  })

  it('speichert niemals Texte, Fragen, Antworten oder eigene Saetze', () => {
    const lib = library()
    saveCoachPosition('u1', 't-produce')
    for (const step of unitOf(lib).steps) saveCoachStepResult('u1', step, 'self-ok')
    const raw = window.localStorage.getItem(COACH_STORAGE_KEY)
    for (const secret of ['Right sentence one', 'WRONG-OPTION', 'ERKLAERUNG', 'Model sentence', 'Absatz eins', 'passes', 'Punkt eins']) expect(raw).not.toContain(secret)
    expect(Object.keys(JSON.parse(raw).units.u1.steps['t-produce']).sort()).toEqual(['attempts', 'revision', 'status', 'updatedAt'])
  })

  it('Resume: Position bleibt erhalten, Neustart setzt nur die Position zurueck', () => {
    saveCoachPosition('u1', 't-gap', new Date('2026-11-02T10:00:00Z'))
    expect(getCoachUnitState('u1')).toMatchObject({ currentStepId: 't-gap', startedAt: '2026-11-02T10:00:00.000Z', completedAt: null })
    saveCoachStepResult('u1', stepOf(library(), 't-gap'), 'incorrect')
    resetCoachPosition('u1')
    const state = getCoachUnitState('u1')
    expect(state.currentStepId).toBeNull()
    expect(state.steps['t-gap']).toMatchObject({ status: 'incorrect', attempts: 1 })
  })

  it('zaehlt Versuche pro Schritt und lehnt ungueltige Status/IDs ab', () => {
    const step = stepOf(library(), 't-choice')
    saveCoachStepResult('u1', step, 'incorrect')
    saveCoachStepResult('u1', step, 'correct')
    expect(getCoachUnitState('u1').steps['t-choice']).toMatchObject({ status: 'correct', attempts: 2 })
    expect(saveCoachStepResult('u1', step, 'bogus')).toBe(false)
    expect(saveCoachStepResult('', step, 'correct')).toBe(false)
    expect(saveCoachStepResult('u1', { stepId: 'x' }, 'correct')).toBe(false)
    expect(saveCoachPosition('u1', '')).toBe(false)
  })

  it('kuerzt unbekannte Felder und kaputte Eintraege beim Lesen ab (Allowlist)', () => {
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      units: { u1: { currentStepId: 't-gap', secret: 'privat', steps: { good: { status: 'correct', attempts: 1, revision: 'abc', updatedAt: '2026-11-01T00:00:00Z', text: 'privat' }, bad: { status: 'x' } } } },
    }))
    const state = getCoachUnitState('u1')
    expect(Object.keys(state.steps)).toEqual(['good'])
    expect(state.steps.good).toEqual({ status: 'correct', attempts: 1, revision: 'abc', updatedAt: '2026-11-01T00:00:00Z' })
    expect(state).not.toHaveProperty('secret')
  })
})

describe('Coach-Fortschritt: Bibliotheksversionen loeschen nichts still', () => {
  it('geaenderter Schritt gilt als veraltet, der alte Eintrag bleibt erhalten; unveraenderte bleiben gueltig', () => {
    const v1 = library()
    for (const id of ['t-choice', 't-gap']) saveCoachStepResult('u1', stepOf(v1, id), 'correct')
    const v2 = validateCoachLibrary({ ...withStep(coachLibraryData(), 't-gap', { acceptedAnswers: ['passes', 'passed'] }), libraryVersion: 2 })
    const overview = getUnitStepOverview(unitOf(v2))
    expect(overview.current).toEqual(['t-choice'])
    expect(overview.stale).toEqual(['t-gap'])
    expect(getCoachUnitState('u1').steps['t-gap']).toMatchObject({ status: 'correct', revision: stepOf(v1, 't-gap').revision }) // alter Eintrag unveraendert
  })

  it('entfernte Schritte hinterlassen verwaiste Eintraege, neue Schritte gelten als offen', () => {
    const v1 = library()
    saveCoachStepResult('u1', stepOf(v1, 't-choice'), 'correct')
    const data = coachLibraryData()
    data.units[0].steps = data.units[0].steps.filter((step) => step.stepId !== 't-choice')
    const v2 = validateCoachLibrary({ ...data, libraryVersion: 2 })
    expect(getUnitStepOverview(unitOf(v2)).open).toContain('t-gap')
    expect(getCoachUnitState('u1').steps).toHaveProperty('t-choice')
  })

  it('schwierige Schritte werden aus dem Ergebnis abgeleitet', () => {
    const lib = library()
    saveCoachStepResult('u1', stepOf(lib, 't-choice'), 'incorrect')
    saveCoachStepResult('u1', stepOf(lib, 't-gap'), 'correct')
    saveCoachStepResult('u1', stepOf(lib, 't-produce'), 'self-almost')
    expect(getUnitStepOverview(unitOf(lib)).difficult.sort()).toEqual(['t-choice', 't-produce'])
  })

  it('unlesbarer oder fremder Speicherstand wird gesichert, bevor neu begonnen wird', () => {
    const foreign = JSON.stringify({ schemaVersion: 99, units: { u1: { currentStepId: 'x' } } })
    window.localStorage.setItem(COACH_STORAGE_KEY, foreign)
    expect(getCoachUnitState('u1').currentStepId).toBeNull()
    expect(window.localStorage.getItem(COACH_UNREADABLE_KEY)).toBe(foreign)
    expect(window.localStorage.getItem(COACH_STORAGE_KEY)).toBe(foreign) // Original wird erst beim naechsten Schreiben ersetzt

    window.localStorage.setItem(COACH_STORAGE_KEY, '{kaputt')
    getCoachUnitState('u1')
    expect(window.localStorage.getItem(COACH_UNREADABLE_KEY)).toBe('{kaputt')
  })
})

describe('Coach-Wiederholung (einfaches Intervall 1 / 3 / 7 Tage)', () => {
  const now = new Date('2026-11-02T08:00:00Z')

  it('plant nach Schwierigkeiten morgen, sonst die naechste Stufe', () => {
    const first = nextReviewState(null, { hadTrouble: false }, now)
    expect(first).toMatchObject({ box: 1, dueAt: new Date(now.getTime() + DAY).toISOString() })
    const second = nextReviewState(first, { hadTrouble: false }, now)
    expect(second).toMatchObject({ box: 2, dueAt: new Date(now.getTime() + 3 * DAY).toISOString() })
    const third = nextReviewState(second, { hadTrouble: false }, now)
    expect(third.box).toBe(3)
    expect(nextReviewState(third, { hadTrouble: false }, now).box).toBe(3) // Obergrenze
    expect(nextReviewState(third, { hadTrouble: true }, now).box).toBe(1) // Rueckfall bei Schwierigkeiten
  })

  it('abschliessen: Position leer, completedAt nur beim Lernen, Wiederholung faellig nach Ablauf', () => {
    saveCoachPosition('u1', 't-gap', now)
    completeCoachUnit('u1', { hadTrouble: true, mode: 'learn' }, now)
    let state = getCoachUnitState('u1')
    expect(state).toMatchObject({ currentStepId: null, completedAt: now.toISOString() })
    expect(isReviewDue(state, now)).toBe(false)
    expect(isReviewDue(state, new Date(now.getTime() + DAY))).toBe(true)

    completeCoachUnit('u1', { hadTrouble: false, mode: 'review' }, new Date(now.getTime() + DAY))
    state = getCoachUnitState('u1')
    expect(state.completedAt).toBe(now.toISOString()) // Wiederholung aendert completedAt nicht
    expect(state.review.box).toBe(2)
  })
})
