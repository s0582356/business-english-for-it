import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COACH_AREA_ID, contentRevision, isCoachLibraryData, validateCoachLibrary } from '../coachLibrary.js'
import { checkSentence } from '../coachSentenceCheck.js'
import { coachLibraryData, guidedLibraryData, withStep } from './coachTestHelpers.js'

function expectInvalid(mutate, message) {
  const data = coachLibraryData()
  mutate(data)
  expect(() => validateCoachLibrary(data)).toThrow(message)
}

describe('Coach-Bibliothek: Validator und Versionsvertrag', () => {
  it('erkennt den Dateityp und akzeptiert die neutrale Testbibliothek', () => {
    expect(isCoachLibraryData(coachLibraryData())).toBe(true)
    expect(isCoachLibraryData({ type: 'businessEnglishLibrary' })).toBe(false)
    expect(isCoachLibraryData([])).toBe(false)
    const library = validateCoachLibrary(coachLibraryData())
    expect(library).toMatchObject({ libraryId: 'test-coach-v1', libraryVersion: 1, areaId: COACH_AREA_ID })
    expect(library.units[0].steps.map((step) => step.type)).toEqual(['explain', 'examples', 'choice', 'gap', 'produce', 'recap'])
  })

  it('erzwingt den Versionsvertrag: type, schemaVersion, libraryId, libraryVersion, areaId', () => {
    expectInvalid((d) => { d.type = 'andere' }, 'nicht als Business-English-Lerncoach-Bibliothek')
    expectInvalid((d) => { d.schemaVersion = 2 }, 'schemaVersion')
    expectInvalid((d) => { d.libraryId = '' }, 'libraryId')
    expectInvalid((d) => { d.libraryVersion = 0 }, 'libraryVersion')
    expectInvalid((d) => { d.libraryVersion = '1' }, 'libraryVersion')
    expectInvalid((d) => { d.areaId = 'telephoning' }, 'areaId')
    expectInvalid((d) => { d.units = [] }, 'units')
  })

  it('verlangt eindeutige stabile IDs ueber Einheiten, Schritte und Beispiele', () => {
    expectInvalid((d) => { d.units[0].steps[3].stepId = 't-choice' }, 'Doppelte stepId')
    expectInvalid((d) => { d.units[0].steps[1].examples[1].exampleId = 't-ex-1' }, 'Doppelte exampleId')
    expectInvalid((d) => { d.units[0].steps[1].examples[0].exampleId = 't-gap' }, 'Doppelte')
    expectInvalid((d) => { d.units.push({ ...d.units[0], steps: [{ stepId: 'x', type: 'recap', title: 't', points: ['p'], recommendation: 'r' }] }) }, 'Doppelte unitId')
  })

  it('prueft Schritt-Typen und Pflichtfelder', () => {
    expectInvalid((d) => { d.units[0].steps[0].type = 'video' }, '"type"')
    expectInvalid((d) => { d.units[0].steps[0].paragraphs = [] }, 'paragraphs')
    expectInvalid((d) => { d.units[0].steps[1].examples[0].de = '' }, '"de"')
    expectInvalid((d) => { d.units[0].steps[4].modelAnswers = [] }, 'modelAnswers')
    expectInvalid((d) => { d.units[0].steps[4].checklist = [] }, 'checklist')
    expectInvalid((d) => { d.units[0].steps[4].feedback = ' ' }, 'feedback')
    expectInvalid((d) => { d.units[0].steps[5].recommendation = '' }, 'recommendation')
    expectInvalid((d) => { d.units[0].estimatedMinutes = 0 }, 'estimatedMinutes')
  })

  it('delegiert choice/gap an die bestehenden Item-Validatoren (correctAnswer muss in options liegen)', () => {
    expectInvalid((d) => { d.units[0].steps[2].correctAnswer = 'nicht vorhanden' }, '"correctAnswer" muss in "options"')
    expectInvalid((d) => { d.units[0].steps[3].acceptedAnswers = [] }, 'acceptedAnswers')
    expectInvalid((d) => { d.units[0].steps[2].explanation = '' }, 'explanation')
  })

  it('verlangt bei Lueckenaufgaben genau eine Luecke', () => {
    expectInvalid((d) => { d.units[0].steps[3].prompt = 'Complete: "The ___ test ___ today."' }, 'genau eine Lücke')
    expectInvalid((d) => { d.units[0].steps[3].prompt = 'Complete the sentence without blank.' }, 'genau eine Lücke')
  })

  it('leitet areaId fuer Audio ab und bildet choice/gap/produce/examples als audiofaehige Items ab', () => {
    const library = validateCoachLibrary(coachLibraryData())
    const [explain, examples, choice, gap, produce] = library.units[0].steps
    expect(explain.areaId).toBe(COACH_AREA_ID)
    expect(examples.examples.map((e) => ({ id: e.id, itemId: e.itemId, type: e.type, areaId: e.areaId }))).toEqual([
      { id: 't-ex-1', itemId: 't-ex-1', type: 'example', areaId: COACH_AREA_ID },
      { id: 't-ex-2', itemId: 't-ex-2', type: 'example', areaId: COACH_AREA_ID },
    ])
    expect(choice).toMatchObject({ id: 't-choice', itemId: 't-choice', stepId: 't-choice', type: 'choice', areaId: COACH_AREA_ID })
    expect(gap).toMatchObject({ id: 't-gap', type: 'gap', areaId: COACH_AREA_ID })
    expect(produce).toMatchObject({ id: 't-produce', type: 'produce', areaId: COACH_AREA_ID })
  })

  it('revision ist pro Schritt stabil und aendert sich nur mit dem Inhalt dieses Schritts', () => {
    const base = validateCoachLibrary(coachLibraryData())
    const same = validateCoachLibrary(coachLibraryData())
    const changed = validateCoachLibrary(withStep(coachLibraryData(), 't-gap', { acceptedAnswers: ['passes', 'passed'] }))
    const revisions = (library) => Object.fromEntries(library.units[0].steps.map((step) => [step.stepId, step.revision]))
    expect(revisions(same)).toEqual(revisions(base))
    expect(revisions(changed)['t-gap']).not.toBe(revisions(base)['t-gap'])
    for (const id of ['t-explain', 't-examples', 't-choice', 't-produce', 't-recap']) expect(revisions(changed)[id]).toBe(revisions(base)[id])
    expect(contentRevision({ a: 1, b: [1, 2] })).toBe(contentRevision({ b: [1, 2], a: 1 })) // Schluesselreihenfolge egal
  })
})

// Regression gegen die echte private Pilot-Bibliothek (nur lokal vorhanden, sonst uebersprungen).
const PRIVATE_COACH = join(resolve(__dirname, '../../..'), 'private/w3/w3-lerncoach.json')

describe.skipIf(!existsSync(PRIVATE_COACH))('Coach-Bibliothek: echte private Pilot-Bibliothek', () => {
  const library = () => validateCoachLibrary(JSON.parse(readFileSync(PRIVATE_COACH, 'utf8')))

  it('ist gueltig, hat den Versionsvertrag und genau die Pilot-Einheit mit dem vollen Lernweg', () => {
    const { libraryId, libraryVersion, areaId, units } = library()
    expect({ libraryId, libraryVersion, areaId }).toEqual({ libraryId: 'business-english-w3-lerncoach-v1', libraryVersion: 2, areaId: 'w3-lerncoach' })
    expect(units.map((unit) => unit.unitId)).toEqual(['cond-type-1'])
    // Version 2: bestehende Schritt-IDs bleiben, zwei Transferaufgaben kommen vor dem Fazit dazu
    expect(units[0].steps.map((step) => step.stepId)).toEqual(['cond1-explain', 'cond1-examples', 'cond1-choice', 'cond1-gap', 'cond1-produce', 'cond1-transfer-a', 'cond1-transfer-b', 'cond1-recap'])
    expect(units[0].steps.map((step) => step.type)).toEqual(['explain', 'examples', 'choice', 'gap', 'produce', 'produce', 'produce', 'recap'])
    expect(units[0].steps.find((step) => step.type === 'examples').examples).toHaveLength(5)
  })

  it('Choice hat genau eine richtige Option und Gap genau eine Luecke und eine akzeptierte Antwort', () => {
    const steps = library().units[0].steps
    const choice = steps.find((step) => step.type === 'choice')
    expect(choice.options.filter((option) => option === choice.correctAnswer)).toHaveLength(1)
    const gap = steps.find((step) => step.type === 'gap')
    expect(gap.prompt.match(/_{2,}/g)).toHaveLength(1)
    expect(gap.acceptedAnswers).toEqual(['fails'])
  })
  it('Version 2: Transferaufgaben A (if vorn) und B (if hinten) mit Strukturcheck, Wortschatzhinweis und mehreren Musterloesungen', () => {
    const steps = library().units[0].steps
    const [a, b] = ['cond1-transfer-a', 'cond1-transfer-b'].map((id) => steps.find((step) => step.stepId === id))
    expect(a).toMatchObject({ variant: 'transfer', check: { type: 'conditional-type-1', position: 'start' } })
    expect(b).toMatchObject({ variant: 'transfer', check: { type: 'conditional-type-1', position: 'end' } })
    for (const step of [a, b]) {
      expect(step.hint).toBeTruthy()
      expect(step.modelAnswers.length).toBeGreaterThanOrEqual(3)
      // keine Musterloesung widerspricht dem eigenen Strukturcheck oder der Checkliste (auch die Varianten)
      for (const model of step.modelAnswers) expect(checkSentence(step.check, model).outcome, model).toBe('met')
    }
    expect(a.prompt).toBeTruthy()
    expect(b.prompt).toBeTruthy()
  })

  it('cond1-produce behaelt seine ID und bekommt nur den Strukturcheck dazu (sein Audiotext bleibt, siehe Audio-Test mit dem unveraenderten Dateinamen)', () => {
    const produce = library().units[0].steps.find((step) => step.stepId === 'cond1-produce')
    expect(produce.check).toEqual({ type: 'conditional-type-1', position: 'any' })
    expect(produce.modelAnswers.length).toBeGreaterThanOrEqual(1)
  })
})

describe('Coach-Bibliothek: gefuehrtes Schreibtraining (check, hint, variant)', () => {
  it('akzeptiert check/hint/variant bei produce und gibt sie im Schritt weiter', () => {
    const steps = validateCoachLibrary(guidedLibraryData()).units[0].steps
    const transfer = steps.find((step) => step.stepId === 't-transfer')
    expect(transfer).toMatchObject({ variant: 'transfer', hint: 'WORT-HINWEIS', check: { type: 'conditional-type-1', position: 'end' } })
  })

  it('Schritte ohne die neuen Felder bleiben unveraendert (gleiche revision wie in Version 1)', () => {
    const plain = validateCoachLibrary(coachLibraryData()).units[0].steps.find((step) => step.stepId === 't-produce')
    expect(Object.keys(plain)).not.toContain('check')
    expect(Object.keys(plain)).not.toContain('hint')
    expect(Object.keys(plain)).not.toContain('variant')
    const guided = validateCoachLibrary(guidedLibraryData()).units[0].steps.find((step) => step.stepId === 't-produce')
    expect(guided.revision).not.toBe(plain.revision) // nur wer einen check hinzufuegt, aendert die revision
  })

  it('weist ungueltige Felder zurueck', () => {
    const bad = (change, message) => expect(() => validateCoachLibrary(withStep(guidedLibraryData(), 't-transfer', change))).toThrow(message)
    bad({ check: { type: 'frei-erfunden', position: 'end' } }, '"check"')
    bad({ check: { type: 'conditional-type-1', position: 'mitte' } }, 'position')
    bad({ check: 'ja' }, '"check"')
    bad({ variant: 'bonus' }, '"variant"')
    bad({ hint: '  ' }, '"hint"')
  })

  it('eine Musterloesung, die dem eigenen Strukturcheck widerspricht, verhindert den Import', () => {
    expect(() => validateCoachLibrary(withStep(guidedLibraryData(), 't-transfer', { modelAnswers: ['We will call you if the server stops.', 'If the server will stop, we will call you.'] }))).toThrow('widerspricht dem Strukturcheck')
    expect(() => validateCoachLibrary(withStep(guidedLibraryData(), 't-transfer', { modelAnswers: ['If the server stops, we will call you.'] }))).toThrow('widerspricht dem Strukturcheck') // Position "end" verlangt
  })
})
