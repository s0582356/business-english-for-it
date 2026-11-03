import { beforeEach, describe, expect, it } from 'vitest'
import { COACH_STORAGE_KEY, completeCoachUnit, getCoachUnitState, getUnitStepOverview, isValidDayKey, localDayKey, saveCoachStepResult } from '../coachStorage.js'
import { REPEAT_MIN_DAYS, getUnitProgress } from '../coachProgress.js'
import { checkConditionalType1 } from '../coachSentenceCheck.js'
import { validateCoachLibrary } from '../coachLibrary.js'
import { coachLibraryData, guidedLibraryData, withStep } from './coachTestHelpers.js'

const lib = () => validateCoachLibrary(guidedLibraryData())
const unitOf = (library) => library.units[0]
const stepOf = (library, id) => unitOf(library).steps.find((step) => step.stepId === id)
const day = (n, hour = 10) => new Date(2026, 10, n, hour) // lokale Kalendertage 2026-11-n

const met = { checked: true, tries: 1, first: 'met', final: 'met', tags: [], improved: false, gaveUp: false, copied: false, self: 'self-ok' }
const issues = { checked: true, tries: 2, first: 'issues', final: 'issues', tags: ['will-in-if'], improved: false, gaveUp: false, copied: false, self: 'self-ok' }

function solveEverything(library, when, produce = met) {
  for (const id of ['t-choice', 't-gap']) saveCoachStepResult('u1', stepOf(library, id), 'correct', when)
  for (const id of ['t-produce', 't-transfer']) saveCoachStepResult('u1', stepOf(library, id), 'self-ok', when, { produce })
}

beforeEach(() => window.localStorage.clear())

describe('Fortschritt: getrennte Quellen', () => {
  it('trennt automatisch geprueft, Strukturcheck und Selbsteinschaetzung und mischt nichts', () => {
    const library = lib()
    saveCoachStepResult('u1', stepOf(library, 't-choice'), 'correct', day(3))
    saveCoachStepResult('u1', stepOf(library, 't-gap'), 'incorrect', day(3))
    saveCoachStepResult('u1', stepOf(library, 't-produce'), 'self-almost', day(3), { produce: { ...met, final: 'unclear', self: 'self-almost' } })
    saveCoachStepResult('u1', stepOf(library, 't-transfer'), 'self-ok', day(3), { produce: { ...issues, improved: true } })
    const { counts } = getUnitProgress(unitOf(library), getCoachUnitState('u1'))
    expect(counts.auto).toEqual({ total: 2, answered: 2, correct: 1 })
    expect(counts.structure).toEqual({ total: 2, answered: 2, met: 0 }) // unclear und issues sind kein "Struktur erfuellt"
    expect(counts.self).toMatchObject({ ok: 1, almost: 1, again: 0 })
    expect(counts.improved).toBe(1)
  })

  it('Selbsteinschaetzung "passt" macht einen Satz mit sicherem Strukturfehler nicht zum Erfolg und haelt ihn in der Wiederholung', () => {
    const library = lib()
    saveCoachStepResult('u1', stepOf(library, 't-transfer'), 'self-ok', day(3), { produce: issues })
    expect(getUnitStepOverview(unitOf(library)).difficult).toContain('t-transfer')
    expect(getCoachUnitState('u1').steps['t-transfer'].runs.at(-1)).toMatchObject({ src: 'structure', ok: false })
  })

  it('"Loesung anzeigen" (gave-up) zaehlt nie als geloest, sondern als schwierig', () => {
    const library = lib()
    const gaveUp = { ...met, tries: 0, first: null, final: null, gaveUp: true, self: null }
    saveCoachStepResult('u1', stepOf(library, 't-transfer'), 'gave-up', day(3), { produce: gaveUp })
    expect(getUnitStepOverview(unitOf(library)).difficult).toContain('t-transfer')
    expect(getCoachUnitState('u1').steps['t-transfer'].runs.at(-1)).toMatchObject({ ok: false })
    const progress = getUnitProgress(unitOf(library), getCoachUnitState('u1'))
    expect(progress.counts.gaveUp).toBe(1)
    expect(progress.counts.structure.met).toBe(0)
  })
})

describe('Fortschritt: begrenzte Erfolgsaussagen (kein allgemeines "gefestigt")', () => {
  it('abgeschlossen allein ist nur "durchgearbeitet"; ein einziger Tag reicht fuer MC-/Lueckenaufgaben nicht', () => {
    const library = lib()
    solveEverything(library, day(3))
    completeCoachUnit('u1', { hadTrouble: false }, day(3))
    const progress = getUnitProgress(unitOf(library), getCoachUnitState('u1'), day(3))
    expect(progress.label).toBe('worked-through')
    expect(progress.auto).toMatchObject({ total: 2, days: 1, repeated: false, missingDays: REPEAT_MIN_DAYS - 1 })
    expect(progress.structure).toMatchObject({ days: 1, practiced: false })
  })

  it('mehrfaches Loesen am selben Tag zaehlt nur als ein Tag (kein Hochzaehlen durch Klicks)', () => {
    const library = lib()
    solveEverything(library, day(3, 9))
    solveEverything(library, day(3, 15))
    solveEverything(library, day(3, 21))
    expect(getUnitProgress(unitOf(library), getCoachUnitState('u1'), day(3, 22)).auto).toMatchObject({ days: 1, repeated: false })
  })

  it('MC-/Lueckenaufgaben an zwei verschiedenen Tagen richtig: Aussage nur fuer diese Aufgaben; Struktur wird getrennt gezaehlt', () => {
    const library = lib()
    solveEverything(library, day(3))
    completeCoachUnit('u1', { hadTrouble: false }, day(3))
    solveEverything(library, day(5))
    const progress = getUnitProgress(unitOf(library), getCoachUnitState('u1'), day(5))
    expect(progress.auto).toMatchObject({ days: 2, repeated: true })
    expect(progress.structure).toMatchObject({ days: 2, practiced: true })
    expect(progress.label).toBe('worked-through') // es gibt keinen allgemeinen Status "gefestigt"
    expect(Object.keys(progress)).not.toContain('consolidated')
  })

  it('Strukturcheck-Erfolge an vielen Tagen loesen die MC-/Lueckenaussage NICHT aus', () => {
    const library = lib()
    for (const when of [day(3), day(5), day(8)]) {
      for (const id of ['t-choice', 't-gap']) saveCoachStepResult('u1', stepOf(library, id), 'incorrect', when)
      for (const id of ['t-produce', 't-transfer']) saveCoachStepResult('u1', stepOf(library, id), 'self-ok', when, { produce: met })
    }
    completeCoachUnit('u1', { hadTrouble: false }, day(8))
    const progress = getUnitProgress(unitOf(library), getCoachUnitState('u1'), day(8))
    expect(progress.auto).toMatchObject({ days: 0, repeated: false })
    expect(progress.structure).toMatchObject({ days: 3, practiced: true })
  })

  it('Beispiel Codex: ein grammatisch falscher Satz besteht den Strukturcheck - das erzeugt hoechstens "Struktur geuebt", nie eine MC-/Lueckenaussage', () => {
    const library = lib()
    const result = checkConditionalType1('If the scanner fail, we will notify the team.', { position: 'start' })
    expect(result.outcome).toBe('met') // der Check prueft keine Verbformen - und behauptet auch nichts darueber
    const produce = { ...met, first: result.outcome, final: result.outcome, tags: result.tags }
    for (const when of [day(3), day(5)]) {
      for (const id of ['t-produce', 't-transfer']) saveCoachStepResult('u1', stepOf(library, id), 'self-ok', when, { produce })
    }
    const progress = getUnitProgress(unitOf(library), getCoachUnitState('u1'), day(5))
    expect(progress.auto.repeated).toBe(false)
    expect(progress.counts.auto.answered).toBe(0)
    expect(JSON.stringify(getCoachUnitState('u1'))).not.toMatch(/correct|grammat/i) // keine Aussage zur Korrektheit gespeichert
  })

  it('"nicht zuverlaessig pruefbar" (unclear) ist nie ein Erfolg: kein Erfolgstag, kein ok-Verlauf, aber zur erneuten Uebung vorgemerkt', () => {
    const library = lib()
    const unclear = { ...met, first: 'unclear', final: 'unclear', self: 'self-ok' }
    saveCoachStepResult('u1', stepOf(library, 't-produce'), 'self-ok', day(3), { produce: unclear })
    const entry = getCoachUnitState('u1').steps['t-produce']
    expect(entry.okDays).toBeUndefined()
    expect(entry.runs.at(-1)).toMatchObject({ src: 'structure', ok: false })
    expect(getUnitStepOverview(unitOf(library)).difficult).toContain('t-produce')
    expect(getUnitProgress(unitOf(library), getCoachUnitState('u1')).counts.structure.met).toBe(0)
  })

  it('Freitext nur mit Selbsteinschaetzung (ohne Check) erzeugt nie einen objektiven Nachweis', () => {
    const data = coachLibraryData()
    data.units[0].steps = data.units[0].steps.filter((step) => step.type !== 'choice' && step.type !== 'gap')
    const only = validateCoachLibrary(data)
    for (const when of [day(3), day(5), day(8)]) saveCoachStepResult('u1', stepOf(only, 't-produce'), 'self-ok', when)
    completeCoachUnit('u1', { hadTrouble: false }, day(8))
    const entry = getCoachUnitState('u1').steps['t-produce']
    expect(entry.okDays).toBeUndefined()
    const progress = getUnitProgress(unitOf(only), getCoachUnitState('u1'), day(8))
    expect(progress.auto).toMatchObject({ total: 0, repeated: false })
    expect(progress.structure.total).toBe(0)
    expect(progress.label).toBe('worked-through')
  })

  it('ein spaeterer Fehlversuch geht in den aktuellen Wiederholungsbedarf ein', () => {
    const library = lib()
    solveEverything(library, day(3))
    solveEverything(library, day(5))
    completeCoachUnit('u1', { hadTrouble: false }, day(5))
    saveCoachStepResult('u1', stepOf(library, 't-gap'), 'incorrect', day(8))
    const progress = getUnitProgress(unitOf(library), getCoachUnitState('u1'), day(8))
    expect(progress.auto.repeated).toBe(false) // zuletzt falsch
    expect(progress.label).toBe('review-needed')
    expect(progress.difficult).toBe(1)
    saveCoachStepResult('u1', stepOf(library, 't-gap'), 'correct', day(9)) // danach erneutes Ueben
    const recovered = getUnitProgress(unitOf(library), getCoachUnitState('u1'), day(9))
    expect(recovered.difficult).toBe(0)
    expect(recovered.auto.repeated).toBe(true) // Tage 3, 5 und 9 erfolgreich, zuletzt richtig
  })

  it('Ergebnisse aus einem anderen Inhaltsstand (revision) werden nicht als aktueller Nachweis verwendet', () => {
    const v1 = lib()
    solveEverything(v1, day(3))
    solveEverything(v1, day(5))
    completeCoachUnit('u1', { hadTrouble: false }, day(5))
    const changed = validateCoachLibrary({ ...withStep(guidedLibraryData(), 't-gap', { acceptedAnswers: ['passes', 'passed'] }), libraryVersion: 2 })
    const progress = getUnitProgress(unitOf(changed), getCoachUnitState('u1'), day(6))
    expect(progress.stale).toBe(1)
    expect(progress.auto.repeated).toBe(false)
    expect(progress.label).toBe('review-needed')
    solveEverything(changed, day(6)) // neuer Inhalt: nur EIN Tag mit der neuen Revision
    const after = getUnitProgress(unitOf(changed), getCoachUnitState('u1'), day(6))
    expect(after.auto).toMatchObject({ days: 1, repeated: false })
    expect(getCoachUnitState('u1').steps['t-gap'].okDays).toMatchObject({ rev: stepOf(changed, 't-gap').revision, days: expect.any(Array) })
    expect(getCoachUnitState('u1').steps['t-gap'].okDays.days).toHaveLength(1) // alte Tage gehoeren zur alten Revision
  })
})

describe('Erfolgstage: dauerhaft und platzsparend, unabhaengig vom Versuchsverlauf', () => {
  it('Erfolg an Tag 1, neun Fehlversuche, Erfolg an Tag 2: beide Erfolgstage bleiben trotz Verlaufslimit erhalten', () => {
    const library = lib()
    const step = stepOf(library, 't-choice')
    saveCoachStepResult('u1', step, 'correct', day(3))
    for (let n = 0; n < 9; n++) saveCoachStepResult('u1', step, 'incorrect', day(4, 8 + n))
    saveCoachStepResult('u1', step, 'correct', day(5))
    for (let n = 0; n < 3; n++) saveCoachStepResult('u1', step, 'incorrect', day(6, 8 + n)) // Verlauf ueberschreitet RUN_LIMIT
    const entry = getCoachUnitState('u1').steps['t-choice']
    expect(entry.runs).toHaveLength(10)
    expect(entry.runs.some((run) => localDayKey(new Date(run.at)) === '2026-11-03')).toBe(false) // Tag 1 ist aus dem detaillierten Verlauf verdraengt ...
    expect(entry.okDays.days).toEqual(['2026-11-03', '2026-11-05']) // ... aber als Erfolgstag erhalten
    saveCoachStepResult('u1', step, 'correct', day(7))
    expect(getCoachUnitState('u1').steps['t-choice'].okDays.days).toEqual(['2026-11-03', '2026-11-05', '2026-11-07'])
  })

  it('Erfolgstage sind kompakt (nur Datum, rev, src), begrenzt und enthalten keinen Text', () => {
    const library = lib()
    for (let n = 1; n <= 28; n++) saveCoachStepResult('u1', stepOf(library, 't-choice'), 'correct', new Date(2026, 9, n, 10))
    const okDays = getCoachUnitState('u1').steps['t-choice'].okDays
    expect(Object.keys(okDays).sort()).toEqual(['days', 'rev', 'src'])
    expect(okDays.days).toHaveLength(10)
    expect(okDays.days.at(-1)).toBe('2026-10-28')
    expect(okDays.src).toBe('auto')
    expect(okDays.days.every((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry))).toBe(true)
  })

  it('manipulierte okDays werden beim Lesen bereinigt', () => {
    const library = lib()
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      units: { u1: { currentStepId: null, startedAt: null, completedAt: null, review: null, steps: {
        't-choice': { status: 'correct', attempts: 1, revision: stepOf(library, 't-choice').revision, updatedAt: day(3).toISOString(),
          okDays: { rev: 'abc', src: 'auto', days: ['2026-11-03', 'Mein Satz', '2026-13-45x', '2026-11-03'], text: 'Geheim' } },
        't-gap': { status: 'correct', attempts: 1, revision: stepOf(library, 't-gap').revision, updatedAt: day(3).toISOString(), okDays: { rev: 'abc', src: 'self', days: ['2026-11-03'] } },
      } } },
    }))
    const state = getCoachUnitState('u1')
    expect(state.steps['t-choice'].okDays).toEqual({ rev: 'abc', src: 'auto', days: ['2026-11-03'] })
    expect(state.steps['t-gap'].okDays).toBeUndefined()
    expect(JSON.stringify(state)).not.toContain('Geheim')
  })

  it('V1-Datensaetze ohne die neuen Metadaten: der alte Treffer zaehlt als genau ein Tag, danach geht es normal weiter', () => {
    const library = validateCoachLibrary(coachLibraryData())
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      units: { u1: { currentStepId: null, startedAt: day(1).toISOString(), completedAt: day(1).toISOString(), review: null, steps: {
        't-choice': { status: 'correct', attempts: 4, revision: stepOf(library, 't-choice').revision, updatedAt: day(2).toISOString() },
        't-gap': { status: 'correct', attempts: 2, revision: stepOf(library, 't-gap').revision, updatedAt: day(2).toISOString() },
      } } },
    }))
    const unit = unitOf(library)
    expect(getUnitProgress(unit, getCoachUnitState('u1'), day(3)).auto).toMatchObject({ days: 1, repeated: false })
    saveCoachStepResult('u1', stepOf(library, 't-choice'), 'correct', day(4))
    saveCoachStepResult('u1', stepOf(library, 't-gap'), 'correct', day(4))
    expect(getUnitProgress(unit, getCoachUnitState('u1'), day(4)).auto).toMatchObject({ days: 2, repeated: true })
    expect(getCoachUnitState('u1').steps['t-choice'].attempts).toBe(5) // nichts verloren
  })
})

describe('Fortschritt: neue Aufgaben in bereits durchgearbeiteten Einheiten', () => {
  it('Transferaufgaben, die erst mit der neuen Bibliotheksversion kommen, sind sichtbar; alte Lernstaende bleiben', () => {
    const v1 = validateCoachLibrary(coachLibraryData())
    for (const id of ['t-choice', 't-gap']) saveCoachStepResult('u1', stepOf(v1, id), 'correct', day(3))
    saveCoachStepResult('u1', stepOf(v1, 't-produce'), 'self-ok', day(3))
    completeCoachUnit('u1', { hadTrouble: false }, day(3))
    const v2 = lib() // t-produce bekommt einen check (Revision aendert sich), t-transfer ist neu
    const progress = getUnitProgress(unitOf(v2), getCoachUnitState('u1'), day(4))
    expect(progress.newExercises).toBe(1)
    expect(progress.stale).toBe(1)
    expect(progress.label).toBe('review-needed')
    expect(getCoachUnitState('u1').steps['t-choice']).toMatchObject({ status: 'correct' }) // nichts geloescht
    expect(getCoachUnitState('u1').completedAt).not.toBeNull()
  })
})

describe('Speicher: Allowlist, Migration und Datenschutz', () => {
  it('speichert fuer Freitext nur feste Werte und niemals Text', () => {
    const library = lib()
    const hostile = { ...met, tags: ['will-in-if', 'My secret sentence', '<script>'], first: 'If the secret fails', final: 'met', extra: 'My own sentence', self: 'sehr gut', tries: 99 }
    saveCoachStepResult('u1', stepOf(library, 't-produce'), 'self-ok', day(3), { produce: hostile })
    const raw = window.localStorage.getItem(COACH_STORAGE_KEY)
    for (const forbidden of ['secret', 'script', 'My own', 'sehr gut']) expect(raw).not.toContain(forbidden)
    const stored = getCoachUnitState('u1').steps['t-produce'].produce
    expect(Object.keys(stored).sort()).toEqual(['checked', 'copied', 'final', 'first', 'gaveUp', 'improved', 'self', 'tags', 'tries'])
    expect(stored).toMatchObject({ tags: ['will-in-if'], first: null, final: 'met', self: null, tries: 0 })
  })

  it('manipulierter Speicher wird beim Lesen bereinigt (Allowlist gilt auch beim Lesen)', () => {
    const library = lib()
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      units: { u1: { currentStepId: null, startedAt: null, completedAt: null, review: null, steps: {
        't-produce': { status: 'self-ok', attempts: 1, revision: stepOf(library, 't-produce').revision, updatedAt: day(3).toISOString(),
          sentence: 'Geheimer Satz', runs: [{ at: day(3).toISOString(), rev: 'abc', src: 'auto', ok: true, text: 'Geheim' }, { at: 'kein-datum', rev: 'x', src: 'auto', ok: true }, { at: day(3).toISOString(), rev: 'x', src: 'ki', ok: true }],
          produce: { checked: true, tries: 2, first: 'issues', final: 'met', tags: ['no-if', 'Geheimer Satz'], improved: true, gaveUp: false, copied: false, self: 'self-ok', note: 'Geheim' } },
      } } },
    }))
    const entry = getCoachUnitState('u1').steps['t-produce']
    expect(JSON.stringify(entry)).not.toContain('Geheim')
    expect(entry.runs).toEqual([{ at: day(3).toISOString(), rev: 'abc', src: 'auto', ok: true }])
    expect(entry.produce.tags).toEqual(['no-if'])
  })

  it('Migration: ein alter Speicherstand ohne neue Felder bleibt unveraendert lesbar, schemaVersion 1, keine Sicherung/Neuanfang', () => {
    const library = validateCoachLibrary(coachLibraryData())
    const legacy = JSON.stringify({
      schemaVersion: 1,
      units: { u1: { currentStepId: null, startedAt: day(1).toISOString(), completedAt: day(1).toISOString(),
        steps: { 't-choice': { status: 'correct', attempts: 3, revision: stepOf(library, 't-choice').revision, updatedAt: day(2).toISOString() }, 't-produce': { status: 'self-ok', attempts: 1, revision: stepOf(library, 't-produce').revision, updatedAt: day(2).toISOString() } },
        review: { box: 2, dueAt: day(5).toISOString(), lastReviewedAt: day(2).toISOString() } } },
    })
    window.localStorage.setItem(COACH_STORAGE_KEY, legacy)
    const state = getCoachUnitState('u1')
    expect(state.steps['t-choice']).toEqual({ status: 'correct', attempts: 3, revision: stepOf(library, 't-choice').revision, updatedAt: day(2).toISOString() })
    expect(state.review.box).toBe(2)
    expect(window.localStorage.getItem('businessEnglishCoach:v1:unreadable')).toBeNull()
    // alter automatischer Treffer zaehlt als genau ein Datenpunkt (ein Tag), nie als zwei
    const progress = getUnitProgress(unitOf(library), state, day(3))
    expect(progress.counts.auto.correct).toBe(1)
    expect(progress.auto.repeated).toBe(false)
    // neues Schreiben haengt Metadaten an, ohne den alten Eintrag zu verlieren
    saveCoachStepResult('u1', stepOf(library, 't-choice'), 'correct', day(4))
    expect(getCoachUnitState('u1').steps['t-choice']).toMatchObject({ attempts: 4, runs: [{ src: 'auto', ok: true }] })
  })

  it('der Verlauf ist auf wenige Eintraege begrenzt', () => {
    const library = lib()
    for (let n = 1; n <= 25; n++) saveCoachStepResult('u1', stepOf(library, 't-choice'), 'correct', new Date(2026, 9, n))
    expect(getCoachUnitState('u1').steps['t-choice'].runs).toHaveLength(10)
  })
})

describe('MINOR C: Erfolgstage muessen echte Kalendertage sein', () => {
  const storeWithDays = (library, days, extra = {}) => {
    const steps = {}
    for (const id of ['t-choice', 't-gap']) {
      const step = stepOf(library, id)
      steps[id] = { status: 'correct', attempts: 1, revision: step.revision, updatedAt: day(3).toISOString(), okDays: { rev: step.revision, src: 'auto', days }, ...extra }
    }
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, units: { u1: { currentStepId: null, startedAt: null, completedAt: day(3).toISOString(), review: null, steps } } }))
  }

  it.each([
    ['2026-11-03', true],
    ['2024-02-29', true], // gueltiger Schalttag
    ['2000-02-29', true], // Jahr 2000 ist ein Schaltjahr
    ['2026-12-31', true],
    ['2026-01-01', true],
    ['2025-02-29', false], // kein Schaltjahr
    ['2100-02-29', false], // 2100 ist kein Schaltjahr
    ['2026-02-30', false],
    ['2026-02-31', false],
    ['2026-04-31', false],
    ['2026-99-99', false],
    ['0000-00-00', false],
    ['2026-00-10', false],
    ['2026-13-01', false],
    ['2026-11-00', false],
    ['2026-11-3', false], // falsches Format
    ['2026-11-03T10:00:00Z', false],
    ['1999-12-31', false], // vor der Untergrenze
    ['', false],
    [null, false],
    [20261103, false],
  ])('isValidDayKey(%j) = %s', (value, expected) => {
    expect(isValidDayKey(value)).toBe(expected)
  })

  it('beim Lesen werden unmoegliche Tage verworfen, gueltige Tage und Duplikate bleiben korrekt', () => {
    const library = lib()
    storeWithDays(library, ['0000-00-00', '2026-99-99', '2026-02-30', '2025-02-29', '2024-02-29', '2026-11-03', '2026-11-03', '2026-11-05', '1999-12-31'])
    const okDays = getCoachUnitState('u1').steps['t-choice'].okDays
    expect(okDays.days).toEqual(['2024-02-29', '2026-11-03', '2026-11-05']) // sortiert, ohne Duplikate
    expect(okDays.days).not.toContain('2026-02-30')
  })

  it('ein Eintrag, der nur aus unmoeglichen Tagen besteht, hat danach gar keine Erfolgstage', () => {
    const library = lib()
    storeWithDays(library, ['0000-00-00', '2026-99-99', '2026-02-30'])
    expect(getCoachUnitState('u1').steps['t-choice'].okDays).toBeUndefined()
  })

  it('manipulierte Tage ergeben nie "repeated": true - weder beim Lesen noch bei direkt uebergebenem Zustand', () => {
    const library = lib()
    storeWithDays(library, ['0000-00-00', '2026-99-99'])
    const fromStorage = getUnitProgress(unitOf(library), getCoachUnitState('u1'), day(5))
    expect(fromStorage.auto).toMatchObject({ days: 1, repeated: false }) // nur der echte Altbestand-Treffer (updatedAt) zaehlt, als ein Tag
    // direkter Zustand ohne den Lese-Filter (z. B. andere Aufrufer): coachProgress prueft ebenfalls
    const raw = getCoachUnitState('u1')
    for (const id of ['t-choice', 't-gap']) {
      const step = stepOf(library, id)
      raw.steps[id].okDays = { rev: step.revision, src: 'auto', days: ['0000-00-00', '2026-99-99', '2025-02-29'] }
      raw.steps[id].runs = [{ at: day(3).toISOString(), rev: step.revision, src: 'auto', ok: true }]
    }
    const direct = getUnitProgress(unitOf(library), raw, day(5))
    expect(direct.auto.days).toBe(1) // nur der echte Tag aus dem Verlauf
    expect(direct.auto.repeated).toBe(false)
  })

  it('zwei echte Tage genuegen weiterhin (inklusive Schalttag), unmoegliche Tage daneben schaden nicht', () => {
    const library = lib()
    storeWithDays(library, ['2026-02-30', '2024-02-29', '2024-03-01'])
    saveCoachStepResult('u1', stepOf(library, 't-choice'), 'correct', day(5)) // schreibt weiter, ohne die Bereinigung zu verlieren
    saveCoachStepResult('u1', stepOf(library, 't-gap'), 'correct', day(5))
    const days = getCoachUnitState('u1').steps['t-choice'].okDays.days
    expect(days).toEqual(['2024-02-29', '2024-03-01', '2026-11-05'])
    expect(getUnitProgress(unitOf(library), getCoachUnitState('u1'), day(5)).auto).toMatchObject({ days: 3, repeated: true })
  })

  it('unmoegliche Zeitstempel (Date.parse rollt sie sonst auf einen anderen Tag) werden verworfen, echte Schalttage bleiben', () => {
    const library = lib()
    const step = stepOf(library, 't-choice')
    const entry = (updatedAt, runs) => ({ status: 'correct', attempts: 1, revision: step.revision, updatedAt, ...(runs ? { runs } : {}) })
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      units: { u1: { currentStepId: null, startedAt: '2026-02-30T10:00:00.000Z', completedAt: '2024-02-29T10:00:00.000Z', review: null, steps: {
        'bad-date': entry('2026-02-30T10:00:00.000Z'),
        'bad-leap': entry('2025-02-29T10:00:00.000Z'),
        'good-leap': entry('2024-02-29T10:00:00.000Z'),
        't-choice': entry('2026-11-03T10:00:00.000Z', [
          { at: '2026-02-31T10:00:00.000Z', rev: step.revision, src: 'auto', ok: true },
          { at: '2024-02-29T10:00:00.000Z', rev: step.revision, src: 'auto', ok: true },
        ]),
      } } },
    }))
    const state = getCoachUnitState('u1')
    expect(Object.keys(state.steps).sort()).toEqual(['good-leap', 't-choice'])
    expect(state.startedAt).toBeNull()
    expect(state.completedAt).toBe('2024-02-29T10:00:00.000Z')
    expect(state.steps['t-choice'].runs).toHaveLength(1)
    expect(state.steps['t-choice'].runs[0].at).toBe('2024-02-29T10:00:00.000Z')
  })

  it('bestehende V1-Daten (Zeitstempel im ISO-Format von toISOString) bleiben vollstaendig lesbar', () => {
    const library = validateCoachLibrary(coachLibraryData())
    const stamp = day(2).toISOString()
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      units: { u1: { currentStepId: 't-gap', startedAt: stamp, completedAt: null, steps: { 't-choice': { status: 'correct', attempts: 3, revision: stepOf(library, 't-choice').revision, updatedAt: stamp } }, review: { box: 2, dueAt: stamp, lastReviewedAt: stamp } } },
    }))
    const state = getCoachUnitState('u1')
    expect(state.startedAt).toBe(stamp)
    expect(state.steps['t-choice']).toMatchObject({ status: 'correct', attempts: 3 })
    expect(state.review).toEqual({ box: 2, dueAt: stamp, lastReviewedAt: stamp })
    expect(window.localStorage.getItem('businessEnglishCoach:v1:unreadable')).toBeNull()
  })
})
