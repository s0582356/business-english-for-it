import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App.vue'
import { importCoachFiles } from '../../utils/coachImport.js'
import { validateCoachLibrary } from '../../utils/coachLibrary.js'
import { COACH_STORAGE_KEY, completeCoachUnit, getCoachUnitState, saveCoachStepResult } from '../../utils/coachStorage.js'
import { FakeAudio, installObjectUrlStub, packFor } from '../../utils/__tests__/audioTestHelpers.js'
import { coachLibraryData, guidedLibraryData, jsonFile } from '../../utils/__tests__/coachTestHelpers.js'

const FULL = { LearningNavigator: false, CoachUnitList: false, CoachRunner: false, ChoiceCard: false, AnswerOption: false, GapInputTrainer: false, CoachExampleRow: false, CoachProduceStep: false, AudioButton: false }
const emptyReport = { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] }
const w2Library = {
  areaId: 'telephoning', areaTitle: 'Business Telephoning',
  lessons: [{ lessonId: 'l1', lessonTitle: 'L1', scenarios: [{ scenarioId: 's1', scenarioTitle: 'S1', items: [{ id: 'only-s1', type: 'choice', correctAnswer: 'A' }] }] }],
}
const ImporterStub = {
  name: 'PrivateContentImporter',
  props: ['currentRegistry', 'currentCoach'],
  emits: ['libraries-loaded', 'audio-pack-loaded', 'coach-loaded'],
  setup(_props, { expose }) { expose({ openFilePicker() {} }) },
  template: '<div />',
}

let audioElement
beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  installObjectUrlStub()
  audioElement = new FakeAudio()
  vi.stubGlobal('Audio', function FakeAudioCtor() { return audioElement })
})
afterEach(() => vi.unstubAllGlobals())

async function mountApp(coach = guidedLibraryData()) {
  const wrapper = shallowMount(App, { global: { stubs: { ...FULL, PrivateContentImporter: ImporterStub } } })
  const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
  await importer.vm.$emit('libraries-loaded', { libraryByAreaId: { telephoning: { library: w2Library } }, conflictsByAreaId: {}, report: emptyReport })
  await importer.vm.$emit('coach-loaded', await importCoachFiles([jsonFile(coach)]))
  await flushPromises()
  return { wrapper, importer }
}

const button = (wrapper, text) => wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
async function click(wrapper, text) {
  const target = button(wrapper, text)
  expect(target, `Button "${text}" nicht gefunden`).toBeTruthy()
  await target.trigger('click')
  await flushPromises()
}
async function openCoach(wrapper) {
  await wrapper.get('.navigator-card-group button').trigger('click')
  await wrapper.get('.navigator-card-coach button').trigger('click')
  await flushPromises()
}
// Bis zum ersten Freitext-Schritt (t-produce, Schritt 5 von 7): Choice und Gap richtig.
async function toProduceStep(wrapper, label = 'Starten') {
  await openCoach(wrapper)
  await click(wrapper, label)
  await click(wrapper, 'Weiter')
  await click(wrapper, 'Weiter')
  await click(wrapper, 'Right sentence one.')
  await click(wrapper, 'Weiter')
  await wrapper.get('.gap-answer-input').setValue('passes')
  await click(wrapper, 'Antwort prüfen')
  await click(wrapper, 'Weiter')
  expect(wrapper.text()).toContain('Schritt 5 von 7')
}
const write = async (wrapper, text) => wrapper.get('.coach-answer-input').setValue(text)
// Beim letzten Schritt einer Wiederholung heisst der Knopf "Abschließen" statt "Weiter".
const next = async (wrapper) => click(wrapper, button(wrapper, 'Weiter') ? 'Weiter' : 'Abschließen')
const MODELS = ['If the test fails, we will stop the release.', 'We will call you if the server stops.']

describe('Gefuehrtes Schreibtraining: Ablauf', () => {
  it('Satz -> Strukturfeedback -> ueberarbeiten -> 2. Check -> Vergleich -> erst dann Musterloesungen -> Selbsteinschaetzung', async () => {
    const { wrapper } = await mountApp()
    await toProduceStep(wrapper)

    // 1 Eigener Satz: keine Musterloesung, kein Fertig-Knopf ohne Eingabe, aber ein bewusster Ausstieg
    expect(button(wrapper, 'Struktur prüfen').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'Lösung anzeigen')).toBeTruthy()
    for (const model of MODELS) expect(wrapper.text()).not.toContain(model)
    expect(wrapper.text()).not.toContain('Mehrere Formulierungen sind richtig')

    // 2 Strukturfeedback (Komma fehlt): sicherer Hinweis, ehrlich begrenzt, Musterloesung bleibt gesperrt
    await write(wrapper, 'If the test fails we will stop the work')
    await click(wrapper, 'Struktur prüfen')
    expect(wrapper.text()).toContain('Strukturfehler erkannt')
    expect(wrapper.text()).toContain('Deine 1. Fassung: If the test fails we will stop the work')
    expect(wrapper.text()).toContain('folgt nach ihm ein Komma')
    expect(wrapper.text()).toContain('Der Strukturcheck prüft nicht:')
    expect(wrapper.text()).toContain('Rechtschreibung')
    expect(wrapper.text()).toContain('Punkt eins.') // Checkliste hilft beim Ueberarbeiten
    for (const model of MODELS) expect(wrapper.text()).not.toContain(model)
    expect(getCoachUnitState('u1').steps['t-produce']).toBeUndefined() // noch nichts bewertet oder gespeichert

    // 3 Ueberarbeiten: erste Fassung steht im Feld, ein unveraenderter Satz kann nicht erneut "geprueft" werden
    await click(wrapper, 'Satz überarbeiten')
    expect(wrapper.get('.coach-answer-input').element.value).toBe('If the test fails we will stop the work')
    expect(button(wrapper, '2. Fassung prüfen').attributes('disabled')).toBeDefined()
    await write(wrapper, 'If the test fails, we will stop the work')
    await click(wrapper, '2. Fassung prüfen')
    expect(wrapper.text()).toContain('Struktur erfüllt')
    expect(wrapper.text()).toContain('nicht, dass dein Satz grammatisch korrekt ist')
    for (const model of MODELS) expect(wrapper.text()).not.toContain(model)

    // 4 Vergleich beider Fassungen und erst jetzt die Musterloesungen
    await click(wrapper, 'Musterlösungen ansehen')
    expect(wrapper.text()).toContain('1. Fassung: If the test fails we will stop the work')
    expect(wrapper.text()).toContain('2. Fassung: If the test fails, we will stop the work')
    expect(wrapper.text()).toContain('Struktur im zweiten Versuch verbessert')
    expect(wrapper.text()).toContain('Das ist keine Grammatikbewertung')
    expect(wrapper.text()).toContain('Mehrere Formulierungen sind richtig.')
    expect(wrapper.text()).toContain(MODELS[0])
    expect(getCoachUnitState('u1').steps['t-produce']).toBeUndefined() // Selbsteinschaetzung steht noch aus

    // 5 Selbsteinschaetzung: gespeichert getrennt vom Strukturergebnis
    await click(wrapper, 'Fast – kleine Fehler')
    expect(wrapper.text()).toContain('Gespeichert: Fast – kleine Fehler.')
    const saved = getCoachUnitState('u1').steps['t-produce']
    expect(saved.status).toBe('self-almost')
    expect(saved.produce).toEqual({ checked: true, tries: 2, first: 'issues', final: 'met', tags: [], improved: true, gaveUp: false, copied: false, self: 'self-almost' })
    expect(saved.runs.at(-1)).toMatchObject({ src: 'structure', ok: true })
  })

  it('Satz ist schon beim ersten Mal strukturell in Ordnung: Musterloesung direkt moeglich, Ueberarbeiten nur freiwillig, keine "Verbesserung" erfunden', async () => {
    const { wrapper } = await mountApp()
    await toProduceStep(wrapper)
    await write(wrapper, 'If the build breaks, we will fix it today.')
    await click(wrapper, 'Struktur prüfen')
    expect(wrapper.text()).toContain('Struktur erfüllt')
    expect(button(wrapper, 'Satz trotzdem überarbeiten')).toBeTruthy()
    await click(wrapper, 'Musterlösungen ansehen')
    expect(wrapper.text()).not.toContain('2. Fassung')
    expect(wrapper.text()).not.toContain('verbessert')
    await click(wrapper, 'Passt zur Checkliste')
    expect(getCoachUnitState('u1').steps['t-produce'].produce).toMatchObject({ tries: 1, first: 'met', final: 'met', improved: false, self: 'self-ok' })
  })

  it('unsichere Saetze werden als "nicht zuverlaessig pruefbar" gekennzeichnet, nicht als falsch', async () => {
    const { wrapper } = await mountApp()
    await toProduceStep(wrapper)
    await write(wrapper, 'Unless the test passes, we stop the release.')
    await click(wrapper, 'Struktur prüfen')
    expect(wrapper.text()).toContain('Nicht zuverlässig prüfbar')
    expect(wrapper.text()).not.toContain('Strukturfehler erkannt')
    expect(wrapper.text()).not.toContain('Struktur erfüllt')
    expect(wrapper.find('.coach-check-problem').exists()).toBe(false)
  })

  it('eine Aenderung ohne Verbesserung zaehlt nicht als Verbesserung', async () => {
    const { wrapper } = await mountApp()
    await toProduceStep(wrapper)
    await write(wrapper, 'If the build fails we will stop the deploy')
    await click(wrapper, 'Struktur prüfen')
    await click(wrapper, 'Satz überarbeiten')
    await write(wrapper, 'If the build fails we will stop the deploy today')
    await click(wrapper, '2. Fassung prüfen')
    await click(wrapper, 'Musterlösungen ansehen')
    expect(wrapper.text()).toContain('Keine messbare Verbesserung')
    await click(wrapper, 'Nochmal üben')
    const produce = getCoachUnitState('u1').steps['t-produce'].produce
    expect(produce).toMatchObject({ first: 'issues', final: 'issues', improved: false, tags: ['missing-comma'] })
    expect(getCoachUnitState('u1').steps['t-produce'].runs.at(-1)).toMatchObject({ ok: false })
  })

  it('Transferaufgabe: if-Teil am Ende wird verlangt, Wortschatzhinweis wird angezeigt', async () => {
    const { wrapper } = await mountApp()
    await toProduceStep(wrapper)
    await click(wrapper, 'Lösung anzeigen')
    await click(wrapper, 'Weiter')
    expect(wrapper.text()).toContain('Schritt 6 von 7')
    expect(wrapper.text()).toContain('Transfer')
    expect(wrapper.text()).toContain('WORT-HINWEIS')
    await write(wrapper, 'If the server stops, we will call you.')
    await click(wrapper, 'Struktur prüfen')
    expect(wrapper.text()).toContain('Die Aufgabe verlangt den if-Teil am Ende')
    await click(wrapper, 'Satz überarbeiten')
    await write(wrapper, 'We will call you if the server stops working.')
    await click(wrapper, '2. Fassung prüfen')
    expect(wrapper.text()).toContain('Struktur erfüllt')
  })

  it('Abschreiben: ein Satz, der schon in der Lektion steht, gilt nicht als Erfolg', async () => {
    const { wrapper } = await mountApp()
    await toProduceStep(wrapper)
    await write(wrapper, 'we will call you if the server stops')
    await click(wrapper, 'Struktur prüfen')
    expect(wrapper.text()).toContain('Genau dieser Satz steht schon in der Lektion')
    expect(wrapper.text()).toContain('Strukturfehler erkannt')
    await click(wrapper, 'Satz überarbeiten')
    await write(wrapper, 'We will call you if the server stops again.')
    await click(wrapper, '2. Fassung prüfen')
    expect(wrapper.text()).toContain('Struktur erfüllt')
  })
})

describe('Gefuehrtes Schreibtraining: Loesung anzeigen als bewusster Ausstieg', () => {
  it('zeigt Musterloesungen, zaehlt nicht als geloest, keine Selbsteinschaetzung, kommt in die Wiederholung', async () => {
    const { wrapper } = await mountApp()
    await toProduceStep(wrapper)
    await click(wrapper, 'Lösung anzeigen')
    expect(wrapper.text()).toContain(MODELS[0])
    expect(wrapper.text()).toContain('zählt nicht als gelöst')
    expect(button(wrapper, 'Passt zur Checkliste')).toBeUndefined()
    const saved = getCoachUnitState('u1').steps['t-produce']
    expect(saved.status).toBe('gave-up')
    expect(saved.produce).toMatchObject({ gaveUp: true, tries: 0, first: null, final: null })
    expect(saved.runs.at(-1)).toMatchObject({ src: 'structure', ok: false })
    await click(wrapper, 'Weiter') // geht weiter zur Transferaufgabe

    // Abbruch nach einem ersten Versuch zaehlt ebenfalls nicht als geloest
    await write(wrapper, 'We will call you if the server stops working.')
    await click(wrapper, 'Struktur prüfen')
    await click(wrapper, 'trotzdem überarbeiten')
    await click(wrapper, 'Lösung anzeigen')
    expect(getCoachUnitState('u1').steps['t-transfer']).toMatchObject({ status: 'gave-up', produce: { gaveUp: true, tries: 1, first: 'met', final: 'met' } })
    await click(wrapper, 'Weiter')
    await click(wrapper, 'Einheit abschließen')
    expect(wrapper.text()).toContain('Lösung direkt angezeigt')
    expect(wrapper.text()).toContain('Einige Punkte waren noch nicht sicher')
    expect(wrapper.text()).not.toContain('Strukturcheck (eigene Sätze)') // aufgegebene Saetze zaehlen nicht als "Struktur erfuellt"
  })
})

describe('Gefuehrtes Schreibtraining: Datenschutz', () => {
  it('eigene Saetze landen nirgends: weder in localStorage/sessionStorage noch im Netzwerk noch in der Konsole noch im Ereignis', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const open = vi.spyOn(XMLHttpRequest.prototype, 'open')
    const consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((method) => vi.spyOn(console, method).mockImplementation(() => {}))
    const secret = 'Geheimer Kundensatz Mueller GmbH'
    const { wrapper } = await mountApp()
    await toProduceStep(wrapper)
    await write(wrapper, `If ${secret} fails we will call`)
    await click(wrapper, 'Struktur prüfen')
    await click(wrapper, 'Satz überarbeiten')
    await write(wrapper, `If ${secret} fails, we will call`)
    await click(wrapper, '2. Fassung prüfen')
    await click(wrapper, 'Musterlösungen ansehen')
    await click(wrapper, 'Passt zur Checkliste')

    const everything = JSON.stringify({ ...window.localStorage, ...window.sessionStorage })
    expect(everything).toContain('businessEnglishCoach') // der Fortschritt wurde geschrieben ...
    expect(everything).not.toContain('Mueller') // ... aber nie der Satz
    expect(everything).not.toContain('Geheimer')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    for (const spy of consoleSpies) expect(JSON.stringify(spy.mock.calls)).not.toContain('Mueller')
    const produceStep = wrapper.findComponent({ name: 'CoachRunner' })
    expect(produceStep.exists()).toBe(true)
    for (const emitted of Object.values(produceStep.emitted())) expect(JSON.stringify(emitted)).not.toContain('Mueller')
    open.mockRestore()
    consoleSpies.forEach((spy) => spy.mockRestore())
  })
})

describe('Gefuehrtes Schreibtraining: Audio erst nach Freigabe der Musterloesung', () => {
  it('Musterloesungs-Audio ist vor der Freigabe weder sichtbar noch wird es abgespielt', async () => {
    const library = validateCoachLibrary(guidedLibraryData())
    const items = library.units[0].steps.flatMap((step) => (step.type === 'examples' ? step.examples : [step]))
    const { pack } = await packFor(items)
    const { wrapper, importer } = await mountApp()
    await importer.vm.$emit('audio-pack-loaded', { pack, report: { loaded: [{ fileName: 'coach.zip', fileCount: pack.fileCount }], errors: [] } })
    await toProduceStep(wrapper)
    expect(wrapper.text()).not.toContain('Musterlösung anhören')
    await write(wrapper, 'If the build breaks, we will fix it today.')
    await click(wrapper, 'Struktur prüfen')
    expect(wrapper.text()).not.toContain('Musterlösung anhören')
    expect(audioElement.realPlays).toHaveLength(0)
    await click(wrapper, 'Musterlösungen ansehen')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Musterlösung anhören'))
    await click(wrapper, 'Musterlösung anhören')
    await vi.waitFor(() => expect(audioElement.realPlays.length).toBeGreaterThan(0))
  })
})

describe('Bibliothek V1 -> V2: bereits durchgearbeitete Einheit', () => {
  async function completeV1(wrapper) {
    await openCoach(wrapper)
    await click(wrapper, 'Starten')
    await click(wrapper, 'Weiter')
    await click(wrapper, 'Weiter')
    await click(wrapper, 'Right sentence one.')
    await click(wrapper, 'Weiter')
    await wrapper.get('.gap-answer-input').setValue('passes')
    await click(wrapper, 'Antwort prüfen')
    await click(wrapper, 'Weiter')
    await wrapper.get('.coach-answer-input').setValue('Mein alter Satz.')
    await click(wrapper, 'Mit Musterlösung vergleichen')
    await click(wrapper, 'Passt zur Checkliste')
    await click(wrapper, 'Weiter')
    await click(wrapper, 'Einheit abschließen')
    await click(wrapper, 'Zur Lerncoach-Übersicht')
  }

  it('neue Transferaufgabe ist sichtbar, alter Lernstand bleibt, Wiederholung nimmt neue und geaenderte Aufgaben auf', async () => {
    const { wrapper } = await mountApp(coachLibraryData())
    await completeV1(wrapper)
    const before = getCoachUnitState('u1')
    expect(wrapper.get('.coach-unit-status').text()).toBe('Durchgearbeitet')
    expect(wrapper.text()).not.toContain('Neu:')
    await click(wrapper, '← Business English W3')

    const v2 = { ...guidedLibraryData(), libraryVersion: 2 }
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' }) // die Startseite (und ihr Importer) wurde neu aufgebaut
    await importer.vm.$emit('coach-loaded', await importCoachFiles([jsonFile(v2, 'coach-v2.json')], importer.props('currentCoach')))
    await flushPromises()
    await wrapper.get('.navigator-card-coach button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Neu: 1 Aufgabe (z. B. eigene Sätze) – bitte üben. Dein bisheriger Lernstand bleibt erhalten.')
    expect(wrapper.text()).toContain('Inhalt aktualisiert (1 Schritt) – bitte wiederholen.')
    expect(wrapper.get('.coach-unit-status').text()).toBe('Durchgearbeitet – Wiederholung nötig')
    expect(getCoachUnitState('u1')).toEqual(before) // nichts wurde veraendert oder geloescht

    await click(wrapper, 'Neue Aufgaben üben')
    expect(wrapper.text()).toContain('Wiederholung')
    expect(wrapper.text()).toContain('Schritt 1 von 2') // geaenderter t-produce + neuer t-transfer
    expect(wrapper.text()).toContain('Schreibe einen Satz über einen Testlauf.')
  })

  it('Durchgearbeitet heisst nicht beherrscht: nach dem Abschluss steht keine allgemeine Erfolgsaussage, die Aussage zu MC-/Lueckenaufgaben braucht zwei Tage', async () => {
    const { wrapper } = await mountApp(guidedLibraryData())
    await toProduceStep(wrapper)
    await write(wrapper, 'If the build breaks, we will fix it today.')
    await click(wrapper, 'Struktur prüfen')
    await click(wrapper, 'Musterlösungen ansehen')
    await click(wrapper, 'Passt zur Checkliste')
    await click(wrapper, 'Weiter')
    await write(wrapper, 'We will fix it today if the build breaks.')
    await click(wrapper, 'Struktur prüfen')
    await click(wrapper, 'Musterlösungen ansehen')
    await click(wrapper, 'Passt zur Checkliste')
    await click(wrapper, 'Weiter')
    await click(wrapper, 'Einheit abschließen')
    expect(wrapper.text()).toContain('Einheit durchgearbeitet')
    expect(wrapper.text()).toContain('Durchgearbeitet heißt nicht beherrscht')
    expect(wrapper.text()).not.toMatch(/gefestigt/i)
    await click(wrapper, 'Zur Lerncoach-Übersicht')
    expect(wrapper.get('.coach-unit-status').text()).toBe('Durchgearbeitet')
    expect(wrapper.text()).not.toMatch(/gefestigt/i)
    const details = wrapper.get('.coach-progress-details').text()
    expect(details).toContain('MC-/Lückenaufgaben: bisher an 1 Tag erfolgreich')
    expect(details).not.toContain('an mehreren Tagen erfolgreich')
    expect(details).toContain('Struktur geübt an 2 Tagen'.replace('2 Tagen', '1 Tag')) // zwei Saetze, ein Tag
    expect(details).toContain('keine Grammatikbewertung')
    expect(window.localStorage.getItem(COACH_STORAGE_KEY)).not.toContain('build breaks')
  })

  it('Anzeige nach zwei Tagen: MC-/Lueckenaussage und "Struktur mehrfach geuebt" stehen getrennt und ohne Wort "gefestigt"', async () => {
    const library = validateCoachLibrary(guidedLibraryData())
    const steps = library.units[0].steps
    const met = { checked: true, tries: 1, first: 'met', final: 'met', tags: [], improved: false, gaveUp: false, copied: false, self: 'self-ok' }
    const { wrapper } = await mountApp(guidedLibraryData())
    for (const when of [new Date(2026, 10, 3, 10), new Date(2026, 10, 5, 10)]) {
      for (const id of ['t-choice', 't-gap']) saveCoachStepResult('u1', steps.find((step) => step.stepId === id), 'correct', when)
      for (const id of ['t-produce', 't-transfer']) saveCoachStepResult('u1', steps.find((step) => step.stepId === id), 'self-ok', when, { produce: met })
    }
    completeCoachUnit('u1', { hadTrouble: false }, new Date(2026, 10, 5, 10))
    await openCoach(wrapper)
    const text = wrapper.text()
    expect(text).toContain('MC-/Lückenaufgaben an mehreren Tagen erfolgreich')
    expect(text).toContain('Struktur mehrfach geübt')
    expect(text).toContain('keine Grammatikbewertung')
    expect(text).not.toMatch(/gefestigt/i)
    expect(wrapper.get('.coach-unit-status').text()).toBe('Durchgearbeitet')
  })

  it('MAJOR 3: unklar -> "Passt zur Checkliste" -> Abschluss erhoeht die Wiederholungsstufe nicht und bleibt zur erneuten Uebung vorgemerkt', async () => {
    const library = validateCoachLibrary(guidedLibraryData())
    const steps = library.units[0].steps
    const now = new Date()
    const yesterday = new Date(now.getTime() - 36 * 60 * 60 * 1000)
    const okMet = { checked: true, tries: 1, first: 'met', final: 'met', tags: [], improved: false, gaveUp: false, copied: false, self: 'self-ok' }
    // Einheit durchgearbeitet, Wiederholung Stufe 2 ist faellig, beide Freitexte wurden zuletzt nur "unklar"
    for (const id of ['t-choice', 't-gap']) saveCoachStepResult('u1', steps.find((step) => step.stepId === id), 'correct', yesterday)
    for (const id of ['t-produce', 't-transfer']) saveCoachStepResult('u1', steps.find((step) => step.stepId === id), 'self-ok', yesterday, { produce: { ...okMet, first: 'unclear', final: 'unclear' } })
    completeCoachUnit('u1', { hadTrouble: false }, yesterday)
    const raw = JSON.parse(window.localStorage.getItem(COACH_STORAGE_KEY))
    raw.units.u1.review = { box: 2, dueAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), lastReviewedAt: yesterday.toISOString() }
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify(raw))

    const { wrapper } = await mountApp(guidedLibraryData())
    await openCoach(wrapper)
    expect(wrapper.get('.coach-unit-status').text()).toBe('Durchgearbeitet – Wiederholung nötig') // unklare Freitexte sind vorgemerkt
    await click(wrapper, 'Wiederholen')
    expect(wrapper.text()).toContain('Schritt 1 von 2')
    for (const sentence of ['Unless the test passes, we stop the release today.', 'Unless the server stops, we call you.']) {
      await write(wrapper, sentence)
      await click(wrapper, 'Struktur prüfen')
      expect(wrapper.text()).toContain('Nicht zuverlässig prüfbar')
      await click(wrapper, 'Musterlösungen ansehen')
      await click(wrapper, 'Passt zur Checkliste')
      await next(wrapper)
    }
    expect(wrapper.text()).toContain('Wiederholung abgeschlossen')
    expect(wrapper.text()).toContain('Nicht zuverlässig prüfbar: 2 Sätze')
    expect(wrapper.text()).toContain('kein Erfolgsnachweis')
    expect(wrapper.text()).not.toContain('Struktur im 2. Versuch verbessert')
    expect(wrapper.text()).not.toContain('Strukturcheck (eigene Sätze): bei 1')
    const state = getCoachUnitState('u1')
    expect(state.review.box).toBe(2) // nicht 3: bearbeitet ist nicht erfolgreich geprueft
    expect(state.steps['t-produce'].produce).toMatchObject({ final: 'unclear', self: 'self-ok' })
    expect(state.steps['t-produce'].runs.at(-1)).toMatchObject({ src: 'structure', ok: false })
    expect(state.steps['t-produce'].okDays).toBeUndefined()
    await click(wrapper, 'Zur Lerncoach-Übersicht')
    expect(wrapper.get('.coach-unit-status').text()).toBe('Durchgearbeitet – Wiederholung nötig') // weiter zur Uebung vorgemerkt
  })

  it('Gegenprobe: ein bestaetigter Satz (Struktur erfuellt) bei faelliger Wiederholung erhoeht die Stufe, am selben Tag nicht ein zweites Mal', async () => {
    const library = validateCoachLibrary(guidedLibraryData())
    const steps = library.units[0].steps
    const now = new Date()
    const yesterday = new Date(now.getTime() - 36 * 60 * 60 * 1000)
    const unclear = { checked: true, tries: 1, first: 'unclear', final: 'unclear', tags: [], improved: false, gaveUp: false, copied: false, self: 'self-ok' }
    for (const id of ['t-choice', 't-gap']) saveCoachStepResult('u1', steps.find((step) => step.stepId === id), 'correct', yesterday)
    for (const id of ['t-produce', 't-transfer']) saveCoachStepResult('u1', steps.find((step) => step.stepId === id), 'self-ok', yesterday, { produce: unclear })
    completeCoachUnit('u1', { hadTrouble: false }, yesterday)
    const raw = JSON.parse(window.localStorage.getItem(COACH_STORAGE_KEY))
    raw.units.u1.review = { box: 2, dueAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), lastReviewedAt: yesterday.toISOString() }
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify(raw))

    const { wrapper } = await mountApp(guidedLibraryData())
    await openCoach(wrapper)
    // Spielt eine Wiederholung durch: je nach Schritt Auswahl, Lücke oder eigener Satz
    const runReview = async (sentences) => {
      await click(wrapper, 'Wiederholen')
      const queue = [...sentences]
      for (let guard = 0; guard < 8 && !wrapper.text().includes('Wiederholung abgeschlossen'); guard++) {
        if (wrapper.find('.coach-answer-input').exists()) {
          await write(wrapper, queue.shift())
          await click(wrapper, 'Struktur prüfen')
          await click(wrapper, 'Musterlösungen ansehen')
          await click(wrapper, 'Passt zur Checkliste')
          await next(wrapper)
        } else if (wrapper.find('.gap-answer-input').exists()) {
          await wrapper.get('.gap-answer-input').setValue('passes')
          await click(wrapper, 'Antwort prüfen')
          await click(wrapper, button(wrapper, 'Weiter') ? 'Weiter' : 'Ergebnis anzeigen')
        } else {
          await click(wrapper, 'Right sentence one.')
          await click(wrapper, button(wrapper, 'Weiter') ? 'Weiter' : 'Ergebnis anzeigen')
        }
      }
      expect(wrapper.text()).toContain('Wiederholung abgeschlossen')
      await click(wrapper, 'Zur Lerncoach-Übersicht')
    }
    await runReview(['If the build breaks, we will fix it today.', 'We will call you if the server stops again.'])
    expect(getCoachUnitState('u1').review.box).toBe(3)
    const afterFirst = getCoachUnitState('u1').review
    await runReview(['If the build breaks again, we will fix it today.', 'We will call you if the server stops twice.']) // selber Tag
    expect(getCoachUnitState('u1').review).toEqual(afterFirst)
  })

  describe('MAJOR B: gemischter Review (Choice/Gap richtig, Freitext unklar)', () => {
    async function seedDueReview(box = 2) {
      const library = validateCoachLibrary(guidedLibraryData())
      const steps = library.units[0].steps
      const now = new Date()
      const yesterday = new Date(now.getTime() - 36 * 60 * 60 * 1000)
      const met = { checked: true, tries: 1, first: 'met', final: 'met', tags: [], improved: false, gaveUp: false, copied: false, self: 'self-ok' }
      // Choice und Gap zuletzt falsch (also im Review), Freitext 1 unklar, Transfer erledigt
      for (const id of ['t-choice', 't-gap']) saveCoachStepResult('u1', steps.find((step) => step.stepId === id), 'incorrect', yesterday)
      saveCoachStepResult('u1', steps.find((step) => step.stepId === 't-produce'), 'self-ok', yesterday, { produce: { ...met, first: 'unclear', final: 'unclear' } })
      saveCoachStepResult('u1', steps.find((step) => step.stepId === 't-transfer'), 'self-ok', yesterday, { produce: met })
      completeCoachUnit('u1', { hadTrouble: false }, yesterday)
      const raw = JSON.parse(window.localStorage.getItem(COACH_STORAGE_KEY))
      raw.units.u1.review = { box, dueAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), lastReviewedAt: yesterday.toISOString() }
      window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify(raw))
      return raw.units.u1.review
    }

    async function playMixedReview(wrapper, freeSentence) {
      await openCoach(wrapper)
      await click(wrapper, 'Wiederholen')
      expect(wrapper.text()).toContain('Schritt 1 von 3') // Choice, Gap, unklarer Freitext
      await click(wrapper, 'Right sentence one.')
      await click(wrapper, 'Weiter')
      await wrapper.get('.gap-answer-input').setValue('passes')
      await click(wrapper, 'Antwort prüfen')
      await click(wrapper, 'Weiter')
      await write(wrapper, freeSentence)
      await click(wrapper, 'Struktur prüfen')
    }

    it('Choice/Gap korrekt + Freitext unklar + "Passt zur Checkliste": Stufe und Termin bleiben, Zusammenfassung meldet nicht "kein Problem"', async () => {
      const plan = await seedDueReview(2)
      const { wrapper } = await mountApp(guidedLibraryData())
      await playMixedReview(wrapper, 'Unless the test passes, we stop the release today.')
      expect(wrapper.text()).toContain('Nicht zuverlässig prüfbar')
      await click(wrapper, 'Musterlösungen ansehen')
      await click(wrapper, 'Passt zur Checkliste')
      await click(wrapper, 'Abschließen')

      expect(wrapper.text()).toContain('Wiederholung abgeschlossen')
      expect(wrapper.text()).not.toContain('kein Problem erkannt')
      expect(wrapper.text()).toContain('Noch offen')
      expect(wrapper.text()).toContain('Nicht zuverlässig prüfbar: 1 Satz')
      expect(wrapper.text()).toContain('Automatisch geprüft (Auswahl, Lücken): 2 von 2 richtig')
      const state = getCoachUnitState('u1')
      expect(state.review).toEqual(plan) // Stufe 2 und Termin exakt unveraendert (nicht 3, nicht nach hinten geschoben)
      // erfolgreiche Teilaufgaben bleiben als solche erhalten
      expect(state.steps['t-choice']).toMatchObject({ status: 'correct', runs: expect.arrayContaining([expect.objectContaining({ src: 'auto', ok: true })]) })
      expect(state.steps['t-choice'].okDays.days).toHaveLength(1)
      expect(state.steps['t-gap'].status).toBe('correct')
      // die Selbsteinschaetzung macht aus "unklar" keinen Erfolg; der Satz bleibt vorgemerkt
      expect(state.steps['t-produce'].produce).toMatchObject({ final: 'unclear', self: 'self-ok' })
      expect(state.steps['t-produce'].okDays).toBeUndefined()
      expect(state.steps['t-produce'].runs.at(-1)).toMatchObject({ ok: false })
      await click(wrapper, 'Zur Lerncoach-Übersicht')
      expect(wrapper.get('.coach-unit-status').text()).toBe('Durchgearbeitet – Wiederholung nötig')
      expect(wrapper.text()).toContain('Wiederholungsbedarf: 1 Aufgabe')
    })

    it.each(['If public will changes, we will adapt.', 'If collective will changes, we will adapt.', 'If the client will pay, we will proceed.', 'If he will cooperate, we can proceed.'])('050: korrekter Satz "%s" -> unklar, kein Kompetenznachweis, keine Stufenerhoehung (auch mit richtigen Choice/Gap)', async (sentence) => {
      const plan = await seedDueReview(2)
      const { wrapper } = await mountApp(guidedLibraryData())
      await playMixedReview(wrapper, sentence)
      expect(wrapper.text()).toContain('Nicht zuverlässig prüfbar')
      expect(wrapper.text()).not.toContain('Strukturfehler erkannt') // kein falsches Fehlurteil
      await click(wrapper, 'Musterlösungen ansehen')
      await click(wrapper, 'Passt zur Checkliste')
      await click(wrapper, 'Abschließen')
      expect(wrapper.text()).toContain('Noch offen')
      expect(wrapper.text()).not.toContain('kein Problem erkannt')
      const state = getCoachUnitState('u1')
      expect(state.review).toEqual(plan)
      expect(state.steps['t-produce'].produce).toMatchObject({ first: 'unclear', final: 'unclear', tags: [], self: 'self-ok' })
      expect(state.steps['t-produce'].okDays).toBeUndefined() // kein Erfolgstag, kein Nachweis
      expect(state.steps['t-produce'].runs.at(-1)).toMatchObject({ src: 'structure', ok: false })
      expect(JSON.stringify(state)).not.toMatch(/public|collective|adapt|client|cooperate|proceed/) // kein Satztext im Speicher
    })

    it('Gegenprobe: derselbe gemischte Durchgang mit bestaetigtem Satz steigt auf Stufe 3 und meldet kein offenes Problem', async () => {
      await seedDueReview(2)
      const { wrapper } = await mountApp(guidedLibraryData())
      await playMixedReview(wrapper, 'If the build breaks, we will fix it today.')
      expect(wrapper.text()).toContain('Struktur erfüllt')
      await click(wrapper, 'Musterlösungen ansehen')
      await click(wrapper, 'Passt zur Checkliste')
      await click(wrapper, 'Abschließen')
      expect(wrapper.text()).toContain('kein Problem erkannt')
      expect(wrapper.text()).not.toContain('Noch offen')
      expect(getCoachUnitState('u1').review.box).toBe(3)
    })

    it('Gegenprobe: Choice/Gap falsch + Freitext unklar setzt auf Stufe 1 zurueck (Rueckfall gewinnt)', async () => {
      await seedDueReview(2)
      const { wrapper } = await mountApp(guidedLibraryData())
      await openCoach(wrapper)
      await click(wrapper, 'Wiederholen')
      await click(wrapper, 'WRONG-OPTION-A sentence.')
      await click(wrapper, 'Weiter')
      await wrapper.get('.gap-answer-input').setValue('falsch')
      await click(wrapper, 'Antwort prüfen')
      await click(wrapper, 'Weiter')
      await write(wrapper, 'Unless the test passes, we stop the release today.')
      await click(wrapper, 'Struktur prüfen')
      await click(wrapper, 'Musterlösungen ansehen')
      await click(wrapper, 'Passt zur Checkliste')
      await click(wrapper, 'Abschließen')
      expect(wrapper.text()).toContain('Einige Punkte waren noch nicht sicher')
      expect(getCoachUnitState('u1').review.box).toBe(1)
    })
  })

})
