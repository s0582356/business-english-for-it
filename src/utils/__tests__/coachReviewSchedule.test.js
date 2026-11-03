// Wiederholungsplan: lokale Kalendertage (Europe/Berlin), keine Mehrfach-Stufen am selben Tag, objektive Erfolge.
process.env.TZ = 'Europe/Berlin'

import { beforeEach, describe, expect, it } from 'vitest'
import { COACH_STORAGE_KEY, completeCoachUnit, getCoachUnitState, isReviewDue, localDayKey, localDayStart, nextReviewState, saveCoachStepResult } from '../coachStorage.js'
import { validateCoachLibrary } from '../coachLibrary.js'
import { coachLibraryData } from './coachTestHelpers.js'

const berlin = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min) // lokale Zeit; TZ ist Europe/Berlin
const due = (box, dueAt) => ({ box, dueAt, lastReviewedAt: '2026-01-01T00:00:00.000Z' })

beforeEach(() => window.localStorage.clear())

describe('Zeitzone der Tests', () => {
  it('laeuft in Europe/Berlin (Sommerzeit +2, Winterzeit +1)', () => {
    expect(new Date(2026, 6, 1, 12).getTimezoneOffset()).toBe(-120)
    expect(new Date(2026, 0, 1, 12).getTimezoneOffset()).toBe(-60)
  })
})

describe('Intervalle sind lokale Kalendertage (nicht 24-Stunden-Bloecke)', () => {
  it('Normalfall (Winterzeit): faellig wird am Beginn des lokalen Zieltags, 00:00 Uhr', () => {
    const now = berlin(2026, 11, 3, 15, 30)
    const first = nextReviewState(null, { hadTrouble: false }, now)
    expect(first).toMatchObject({ box: 1, dueAt: '2026-11-03T23:00:00.000Z' }) // 2026-11-04 00:00 Uhr Berlin
    expect(new Date(first.dueAt).getHours()).toBe(0)
    expect(isReviewDue({ review: first }, berlin(2026, 11, 3, 23, 59))).toBe(false)
    expect(isReviewDue({ review: first }, berlin(2026, 11, 4, 0, 0))).toBe(true)
    expect(isReviewDue({ review: first }, berlin(2026, 11, 4, 0, 1))).toBe(true)
  })

  it('Beginn der Sommerzeit (29.03.2026): 3 Tage ab 27.03. enden am 30.03. um 00:00 Uhr Ortszeit', () => {
    const now = berlin(2026, 3, 27, 10)
    const second = nextReviewState(due(1, '2026-03-27T00:00:00.000Z'), { hadTrouble: false }, now)
    expect(second.box).toBe(2)
    expect(second.dueAt).toBe('2026-03-29T22:00:00.000Z') // 30.03. 00:00 CEST
    expect(new Date(second.dueAt).getHours()).toBe(0)
    const fixed24h = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
    expect(fixed24h.getHours()).toBe(11) // eine feste 72-Stunden-Addition wuerde die Uhrzeit verschieben ...
    expect(localDayStart(fixed24h).toISOString()).toBe(second.dueAt) // ... der Kalendertag bleibt aber derselbe
  })

  it('7 Tage ueber die Sommerzeitumstellung: ab 25.03. bis 01.04. um 00:00 Uhr Ortszeit', () => {
    const third = nextReviewState(due(2, '2026-03-25T00:00:00.000Z'), { hadTrouble: false }, berlin(2026, 3, 25, 18))
    expect(third.box).toBe(3)
    expect(third.dueAt).toBe('2026-03-31T22:00:00.000Z') // 01.04. 00:00 CEST
  })

  it('Ende der Sommerzeit (25.10.2026): 3 Tage ab 23.10. enden am 26.10. um 00:00 Uhr Winterzeit', () => {
    const second = nextReviewState(due(1, '2026-10-23T00:00:00.000Z'), { hadTrouble: false }, berlin(2026, 10, 23, 18))
    expect(second.box).toBe(2)
    expect(second.dueAt).toBe('2026-10-25T23:00:00.000Z') // 26.10. 00:00 CET
    expect(new Date(second.dueAt).getHours()).toBe(0)
  })

  it('Tag nach der Umstellung: 1 Tag ab Samstag 28.03. um 23:30 Uhr -> Sonntag 29.03. 00:00 Uhr (nur 22,5 Stunden spaeter ist es der neue Tag)', () => {
    const first = nextReviewState(null, { hadTrouble: false }, berlin(2026, 3, 28, 23, 30))
    expect(first.dueAt).toBe('2026-03-28T23:00:00.000Z')
    expect(isReviewDue({ review: first }, berlin(2026, 3, 29, 0, 5))).toBe(true)
  })

  it('der Kalendertag eines Ergebnisses ist der LOKALE Tag, nicht das UTC-Datum', () => {
    const lateEvening = berlin(2026, 7, 2, 0, 30) // 00:30 CEST = 01.07. 22:30 UTC
    expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-07-01')
    expect(localDayKey(lateEvening)).toBe('2026-07-02')
    const library = validateCoachLibrary(coachLibraryData())
    saveCoachStepResult('u1', library.units[0].steps.find((step) => step.stepId === 't-choice'), 'correct', lateEvening)
    expect(getCoachUnitState('u1').steps['t-choice'].okDays.days).toEqual(['2026-07-02'])
  })

  it('bereits gespeicherte dueAt-Werte (aelteres Format: Zeitpunkt + feste Stunden) bleiben gueltig und werden nicht umgeschrieben', () => {
    const stored = due(2, '2026-11-05T09:00:00.000Z') // altes Format: mitten am Tag
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, units: { u1: { currentStepId: null, startedAt: null, completedAt: '2026-11-02T09:00:00.000Z', steps: {}, review: stored } } }))
    expect(getCoachUnitState('u1').review).toEqual(stored)
    expect(isReviewDue(getCoachUnitState('u1'), new Date('2026-11-05T08:59:00.000Z'))).toBe(false)
    expect(isReviewDue(getCoachUnitState('u1'), new Date('2026-11-05T09:00:00.000Z'))).toBe(true)
    // vor der Faelligkeit: unveraendert; danach: normale Stufe und neues lokales Format
    expect(nextReviewState(stored, { hadTrouble: false }, new Date('2026-11-04T10:00:00.000Z'))).toBe(stored)
    const next = nextReviewState(stored, { hadTrouble: false }, new Date('2026-11-05T10:00:00.000Z'))
    expect(next.box).toBe(3)
    expect(new Date(next.dueAt).getHours()).toBe(0)
  })
})

describe('MAJOR 5-A: Wiederholungsstufe steigt nicht durch mehrfaches Ueben am selben Tag', () => {
  it('drei erfolgreiche Durchlaeufe am selben Tag: Stufe 1 bleibt, Termin bleibt', () => {
    const t = (hour) => berlin(2026, 11, 3, hour)
    completeCoachUnit('u1', { hadTrouble: false }, t(9))
    const afterFirst = getCoachUnitState('u1').review
    expect(afterFirst.box).toBe(1)
    completeCoachUnit('u1', { hadTrouble: false, mode: 'review' }, t(12))
    completeCoachUnit('u1', { hadTrouble: false, mode: 'review' }, t(20))
    expect(getCoachUnitState('u1').review).toEqual(afterFirst)
  })

  it('Stufe 2 und 3 erst, wenn der Termin erreicht ist - jeweils hoechstens einmal je Termin', () => {
    completeCoachUnit('u1', { hadTrouble: false }, berlin(2026, 11, 3, 9))
    completeCoachUnit('u1', { hadTrouble: false, mode: 'review' }, berlin(2026, 11, 4, 8)) // faellig (04.11. 00:00)
    expect(getCoachUnitState('u1').review.box).toBe(2)
    expect(getCoachUnitState('u1').review.dueAt).toBe('2026-11-06T23:00:00.000Z') // 07.11. 00:00
    completeCoachUnit('u1', { hadTrouble: false, mode: 'review' }, berlin(2026, 11, 4, 18)) // am selben Tag nochmal
    completeCoachUnit('u1', { hadTrouble: false, mode: 'review' }, berlin(2026, 11, 6, 12)) // noch nicht faellig
    expect(getCoachUnitState('u1').review.box).toBe(2)
    completeCoachUnit('u1', { hadTrouble: false, mode: 'review' }, berlin(2026, 11, 7, 7)) // faellig
    expect(getCoachUnitState('u1').review.box).toBe(3)
    completeCoachUnit('u1', { hadTrouble: false, mode: 'review' }, berlin(2026, 11, 7, 19))
    expect(getCoachUnitState('u1').review.box).toBe(3)
  })

  it('Schwierigkeiten setzen auch vor der Faelligkeit auf Stufe 1 zurueck (morgen wieder)', () => {
    completeCoachUnit('u1', { hadTrouble: false }, berlin(2026, 11, 3, 9))
    completeCoachUnit('u1', { hadTrouble: false, mode: 'review' }, berlin(2026, 11, 4, 8))
    completeCoachUnit('u1', { hadTrouble: true, mode: 'review' }, berlin(2026, 11, 4, 9))
    expect(getCoachUnitState('u1').review).toMatchObject({ box: 1, dueAt: '2026-11-04T23:00:00.000Z' })
  })
})

describe('MAJOR 3: nur objektive Erfolge erhoehen die Stufe', () => {
  it('ohne objektiven Erfolg (nur unklare/selbst eingeschaetzte Antworten) bleibt die Stufe, der Termin wird neu gesetzt', () => {
    const seeded = due(2, berlin(2026, 11, 3, 0, 0).toISOString())
    expect(nextReviewState(seeded, { hadTrouble: false, objective: false }, berlin(2026, 11, 3, 10))).toMatchObject({ box: 2, dueAt: '2026-11-05T23:00:00.000Z' })
    expect(nextReviewState(seeded, { hadTrouble: false, objective: true }, berlin(2026, 11, 3, 10)).box).toBe(3)
  })

  it('der erste Durchgang ohne Schwierigkeiten startet immer auf Stufe 1, auch ohne objektiven Erfolg', () => {
    expect(nextReviewState(null, { hadTrouble: false, objective: false }, berlin(2026, 11, 3, 10)).box).toBe(1)
  })
})

describe('MAJOR B: gemischter Durchgang - offene Unsicherheit haelt den Wiederholungsplan unveraendert', () => {
  const seeded = due(2, '2026-11-03T00:00:00.000Z')

  it('bei offener Unsicherheit steigt die Stufe nicht und der Termin wird nicht weiter hinausgeschoben, auch mit objektivem Erfolg', () => {
    const now = berlin(2026, 11, 3, 10)
    expect(nextReviewState(seeded, { hadTrouble: false, objective: true, uncertain: true }, now)).toBe(seeded) // exakt unveraendert
    expect(nextReviewState(seeded, { hadTrouble: false, objective: true, uncertain: false }, now).box).toBe(3) // ohne Unsicherheit steigt sie
  })

  it('ein Rueckfall (Schwierigkeiten) gewinnt gegen die Unsicherheit', () => {
    expect(nextReviewState(seeded, { hadTrouble: true, objective: true, uncertain: true }, berlin(2026, 11, 3, 10))).toMatchObject({ box: 1, dueAt: '2026-11-03T23:00:00.000Z' })
  })

  it('ohne bestehenden Plan startet auch ein unsicherer erster Durchgang auf Stufe 1 (morgen)', () => {
    expect(nextReviewState(null, { hadTrouble: false, objective: true, uncertain: true }, berlin(2026, 11, 3, 10))).toMatchObject({ box: 1, dueAt: '2026-11-03T23:00:00.000Z' })
  })

  it('completeCoachUnit reicht die Unsicherheit durch: der gespeicherte Plan bleibt exakt gleich', () => {
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, units: { u1: { currentStepId: null, startedAt: null, completedAt: '2026-11-01T09:00:00.000Z', steps: {}, review: seeded } } }))
    completeCoachUnit('u1', { hadTrouble: false, mode: 'review', objective: true, uncertain: true }, berlin(2026, 11, 3, 10))
    expect(getCoachUnitState('u1').review).toEqual(seeded)
    completeCoachUnit('u1', { hadTrouble: false, mode: 'review', objective: true, uncertain: false }, berlin(2026, 11, 3, 11))
    expect(getCoachUnitState('u1').review.box).toBe(3)
  })
})
