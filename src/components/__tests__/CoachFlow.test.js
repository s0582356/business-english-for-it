import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App.vue'
import { importCoachFiles } from '../../utils/coachImport.js'
import { validateCoachLibrary } from '../../utils/coachLibrary.js'
import { COACH_STORAGE_KEY, getCoachUnitState } from '../../utils/coachStorage.js'
import { PROGRESS_STORAGE_KEY, getItemStatus, recordItemResult } from '../../utils/progressStorage.js'
import { FakeAudio, installObjectUrlStub, packFor } from '../../utils/__tests__/audioTestHelpers.js'
import { coachLibraryData, jsonFile, withStep } from '../../utils/__tests__/coachTestHelpers.js'

const FULL = { LearningNavigator: false, CoachUnitList: false, CoachRunner: false, ChoiceCard: false, AnswerOption: false, GapInputTrainer: false, CoachExampleRow: false, CoachProduceStep: false, AudioButton: false }
const emptyReport = { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] }
const w2Library = {
  areaId: 'telephoning', areaTitle: 'Business Telephoning',
  lessons: [{ lessonId: 'l1', lessonTitle: 'L1', scenarios: [{ scenarioId: 's1', scenarioTitle: 'S1', items: [{ id: 'only-s1', type: 'choice', correctAnswer: 'A' }] }] }],
}

let audioElement
const openFilePicker = vi.fn()
// Importer-Ersatz mit denselben Props/Events und der exponierten Methode, die App.vue fuer "Lernbibliotheken laden" ruft.
const ImporterStub = {
  name: 'PrivateContentImporter',
  props: ['currentRegistry', 'currentCoach'],
  emits: ['libraries-loaded', 'audio-pack-loaded', 'coach-loaded'],
  setup(_props, { expose }) { expose({ openFilePicker }) },
  template: '<div />',
}

beforeEach(() => {
  window.localStorage.clear()
  installObjectUrlStub()
  audioElement = new FakeAudio()
  vi.stubGlobal('Audio', function FakeAudioCtor() { return audioElement })
})
afterEach(() => vi.unstubAllGlobals())

async function mountApp({ coach = coachLibraryData(), quiz = true } = {}) {
  const wrapper = shallowMount(App, { global: { stubs: { ...FULL, PrivateContentImporter: ImporterStub } } })
  const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
  if (quiz) await importer.vm.$emit('libraries-loaded', { libraryByAreaId: { telephoning: { library: w2Library } }, conflictsByAreaId: {}, report: emptyReport })
  if (coach) await importer.vm.$emit('coach-loaded', await importCoachFiles([jsonFile(coach)]))
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
async function startUnit(wrapper, label = 'Starten') {
  await click(wrapper, label)
}

describe('Lerncoach: Navigation und Import', () => {
  it('zeigt die Kachel nur in der W3-Gruppe, ohne die drei Bereiche und ihre Zaehler zu veraendern', async () => {
    const { wrapper } = await mountApp({ coach: null })
    expect(wrapper.text()).toContain('0 von 3 Bereichen geladen')
    expect(wrapper.find('.navigator-card-coach').exists()).toBe(false) // nicht auf der Startseite
    await wrapper.get('.navigator-card-group button').trigger('click')
    expect(wrapper.findAll('.navigator-card-missing')).toHaveLength(3)
    expect(wrapper.get('.navigator-card-coach').text()).toContain('Mein Lerncoach – Englisch Schritt für Schritt')
    expect(wrapper.get('.navigator-card-coach').text()).toContain('Noch nicht geladen')
    await wrapper.get('.back-button').trigger('click')
    expect(wrapper.text()).toContain('0 von 3 Bereichen geladen')
  })

  it('Coach-Import ueber den gemeinsamen Importer: Bericht, geladene Kachel, W2-Bibliothek bleibt unveraendert', async () => {
    const { wrapper } = await mountApp()
    expect(wrapper.text()).toContain('Lerncoach geladen: coach.json')
    expect(wrapper.text()).toContain('0 von 3 Bereichen geladen') // Coach zaehlt nicht als W3-Bereich
    expect(wrapper.findAllComponents({ name: 'LearningNavigator' })[0].props('libraryByAreaId')).toHaveProperty('telephoning')
    await wrapper.get('.navigator-card-group button').trigger('click')
    expect(wrapper.get('.navigator-card-coach').text()).toContain('Lerncoach geladen')
    expect(wrapper.get('.navigator-card-coach').text()).toContain('1 Lerneinheit')
  })

  it('ohne geladene Bibliothek fuehrt die Kachel zum Import und oeffnet keine Ansicht', async () => {
    const { wrapper } = await mountApp({ coach: null })
    await wrapper.get('.navigator-card-group button').trigger('click')
    openFilePicker.mockClear()
    await wrapper.get('.navigator-card-coach button').trigger('click')
    expect(openFilePicker).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.coach-list').exists()).toBe(false)
  })

  it('Upgrade der Coach-Bibliothek wird gemeldet und behaelt gespeicherte Lernstaende', async () => {
    const { wrapper } = await mountApp()
    await openCoach(wrapper)
    await startUnit(wrapper)
    await click(wrapper, 'Weiter') // Erklaerung gesehen
    const before = getCoachUnitState('u1')
    await click(wrapper, 'Zur Lerncoach-Übersicht')
    await click(wrapper, '← Business English W3')
    const v2 = { ...withStep(coachLibraryData(), 't-gap', { acceptedAnswers: ['passes', 'passed'] }), libraryVersion: 2 }
    const importer2 = wrapper.findComponent({ name: 'PrivateContentImporter' })
    await importer2.vm.$emit('coach-loaded', await importCoachFiles([jsonFile(v2, 'coach-v2.json')], importer2.props('currentCoach')))
    await flushPromises()
    expect(wrapper.text()).toContain('Lerncoach aktualisiert auf Version 2 (gespeicherter Lernstand bleibt erhalten)')
    expect(getCoachUnitState('u1')).toEqual(before)
  })
})

describe('Lerncoach: Lernweg Verstehen -> Hoeren -> Ueben -> eigener Satz -> Wiederholen', () => {
  it('fuehrt durch alle sechs Schritte, wertet Choice/Gap aus, bewertet den eigenen Satz nicht automatisch und speichert nur Metadaten', async () => {
    recordItemResult('telephoning', 'only-s1', true)
    const quizBefore = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    const { wrapper } = await mountApp()
    await openCoach(wrapper)
    expect(wrapper.text()).toContain('Test Unit')
    expect(wrapper.text()).toContain('ca. 5 Minuten')
    expect(wrapper.text()).toContain('Noch nicht begonnen')
    await startUnit(wrapper)

    // 1 Verstehen
    expect(wrapper.text()).toContain('Schritt 1 von 6')
    expect(wrapper.text()).toContain('Absatz eins.')
    expect(wrapper.text()).toContain('A + B')
    expect(wrapper.text()).toContain('Achtung-Hinweis.')
    await click(wrapper, 'Weiter')

    // 2 Hoeren: englisch + deutsche Uebersetzung; ohne Audio-Paket gibt es einen Hinweis statt Knoepfen
    expect(wrapper.text()).toContain('The test passes today.')
    expect(wrapper.text()).toContain('Der Test besteht heute.')
    expect(wrapper.text()).toContain('B2-Ausblick')
    expect(wrapper.findAll('.audio-button')).toHaveLength(0)
    expect(wrapper.text()).toContain('Für diese Sätze ist kein Audio geladen.')
    await click(wrapper, 'Weiter')

    // 3 Choice: falsche Antwort -> deutsche Rueckmeldung
    expect(wrapper.text()).toContain('Which sentence is correct?')
    await click(wrapper, 'WRONG-OPTION-A sentence.')
    expect(wrapper.text()).toContain('Nicht ganz.')
    expect(wrapper.text()).toContain('ERKLAERUNG-CHOICE.')
    expect(getCoachUnitState('u1').steps['t-choice'].status).toBe('incorrect')
    await click(wrapper, 'Weiter')

    // 4 Gap: nur eine Luecke, richtige Antwort
    await wrapper.get('.gap-answer-input').setValue('passes')
    await click(wrapper, 'Antwort prüfen')
    expect(wrapper.text()).toContain('Richtig.')
    expect(getCoachUnitState('u1').steps['t-gap'].status).toBe('correct')
    await click(wrapper, 'Weiter')

    // 5 Eigener Satz: erst tippen, dann Vergleich; keine automatische Bewertung
    const compare = button(wrapper, 'Mit Musterlösung vergleichen')
    expect(compare.attributes('disabled')).toBeDefined()
    await wrapper.get('.coach-answer-input').setValue('This is my own unchecked sentence.')
    await click(wrapper, 'Mit Musterlösung vergleichen')
    expect(wrapper.text()).toContain('Dein Satz wird nicht automatisch bewertet.')
    expect(wrapper.text()).toContain('Dein Satz: This is my own unchecked sentence.')
    expect(wrapper.text()).toContain('Punkt eins.')
    expect(wrapper.text()).toContain('Model sentence one.')
    expect(wrapper.text()).toContain('FEEDBACK-PRODUCE.')
    expect(wrapper.find('.feedback-correct').exists()).toBe(false) // nichts wird als richtig gewertet, bevor Altan sich selbst einschaetzt
    expect(wrapper.find('.feedback-wrong').exists()).toBe(false)
    expect(getCoachUnitState('u1').steps['t-produce']).toBeUndefined()
    await click(wrapper, 'Fast – kleine Fehler')
    expect(getCoachUnitState('u1').steps['t-produce'].status).toBe('self-almost')
    expect(wrapper.text()).toContain('Gespeichert: Fast – kleine Fehler.')
    await click(wrapper, 'Weiter')

    // 6 Abschluss mit Wiederholungsempfehlung
    expect(wrapper.text()).toContain('Fazit')
    expect(wrapper.text()).toContain('Morgen wiederholen.')
    await click(wrapper, 'Einheit abschließen')
    expect(wrapper.text()).toContain('Einheit abgeschlossen')
    expect(wrapper.text()).toContain('1 von 3 Übungen sicher gelöst.')
    expect(wrapper.text()).toContain('Nächste Wiederholung empfohlen ab:')

    const state = getCoachUnitState('u1')
    expect(state.completedAt).not.toBeNull()
    expect(state.currentStepId).toBeNull()
    expect(state.review.box).toBe(1) // es gab Schwierigkeiten -> morgen
    expect(Object.keys(state.steps).sort()).toEqual(['t-choice', 't-examples', 't-explain', 't-gap', 't-produce', 't-recap'])

    // Datenschutz: der eigene Satz und Lerninhalte stehen nirgends im Speicher; Quiz-Fortschritt unveraendert
    const everything = JSON.stringify({ ...window.localStorage })
    expect(everything).not.toContain('own unchecked sentence')
    expect(everything).not.toContain('Right sentence one')
    expect(window.localStorage.getItem(PROGRESS_STORAGE_KEY)).toBe(quizBefore)
    expect(getItemStatus('w3-lerncoach', 't-choice')).toBeNull()
  })

  it('Resume: eine begonnene Einheit wird an der gespeicherten Position fortgesetzt', async () => {
    const { wrapper } = await mountApp()
    await openCoach(wrapper)
    await startUnit(wrapper)
    await click(wrapper, 'Weiter')
    await click(wrapper, 'Weiter') // jetzt Schritt 3 (Choice)
    expect(wrapper.text()).toContain('Schritt 3 von 6')
    await click(wrapper, 'Zur Lerncoach-Übersicht')
    expect(wrapper.text()).toContain('Begonnen – weiter bei Schritt 3 von 6')
    await click(wrapper, 'Weiterlernen')
    expect(wrapper.text()).toContain('Schritt 3 von 6')
    expect(wrapper.text()).toContain('Which sentence is correct?')
  })

  it('Resume nach geaenderter Bibliothek: unbekannte gespeicherte Position faellt auf den Anfang zurueck, nichts wird geloescht', async () => {
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      units: { u1: { currentStepId: 'gibt-es-nicht-mehr', startedAt: '2026-11-01T10:00:00.000Z', completedAt: null, steps: { 'alt-entfernt': { status: 'correct', attempts: 2, revision: 'abcd1234', updatedAt: '2026-11-01T10:00:00.000Z' } }, review: null } },
    }))
    const { wrapper } = await mountApp()
    await openCoach(wrapper)
    await startUnit(wrapper)
    expect(wrapper.text()).toContain('Schritt 1 von 6')
    expect(getCoachUnitState('u1').steps['alt-entfernt']).toMatchObject({ status: 'correct', attempts: 2 })
  })

  it('Wiederholung: nach einem Durchgang kommen genau die schwierigen Uebungen wieder, die Wiederholung schliesst ohne completedAt zu aendern', async () => {
    const { wrapper } = await mountApp()
    await openCoach(wrapper)
    await startUnit(wrapper)
    await click(wrapper, 'Weiter')
    await click(wrapper, 'Weiter')
    await click(wrapper, 'WRONG-OPTION-A sentence.')
    await click(wrapper, 'Weiter')
    await wrapper.get('.gap-answer-input').setValue('passes')
    await click(wrapper, 'Antwort prüfen')
    await click(wrapper, 'Weiter')
    await wrapper.get('.coach-answer-input').setValue('Mein Satz.')
    await click(wrapper, 'Mit Musterlösung vergleichen')
    await click(wrapper, 'Passt zur Checkliste')
    await click(wrapper, 'Weiter')
    await click(wrapper, 'Einheit abschließen')
    const completedAt = getCoachUnitState('u1').completedAt
    await click(wrapper, 'Zur Lerncoach-Übersicht')
    expect(wrapper.text()).toContain('Abgeschlossen')
    expect(wrapper.text()).toContain('Nächste Wiederholung:')

    await click(wrapper, 'Wiederholen')
    expect(wrapper.text()).toContain('Wiederholung')
    expect(wrapper.text()).toContain('Schritt 1 von 1') // nur die falsch beantwortete Choice
    expect(wrapper.text()).toContain('Which sentence is correct?')
    await click(wrapper, 'Right sentence one.')
    expect(wrapper.text()).toContain('Richtig.')
    await click(wrapper, 'Ergebnis anzeigen')
    expect(wrapper.text()).toContain('Wiederholung abgeschlossen')
    expect(wrapper.text()).toContain('1 von 1 Übungen sicher gelöst.')
    const state = getCoachUnitState('u1')
    expect(state.completedAt).toBe(completedAt)
    expect(state.steps['t-choice'].status).toBe('correct')
    expect(state.review.box).toBe(2)
  })

  it('geaenderter Schritt nach Bibliotheks-Upgrade: Liste meldet "Inhalt aktualisiert", Lernstand bleibt, Wiederholung nimmt den Schritt wieder auf', async () => {
    const v1 = validateCoachLibrary(coachLibraryData())
    const { wrapper } = await mountApp()
    await openCoach(wrapper)
    await startUnit(wrapper)
    await click(wrapper, 'Weiter')
    await click(wrapper, 'Weiter')
    await click(wrapper, 'Right sentence one.')
    await click(wrapper, 'Weiter')
    await wrapper.get('.gap-answer-input').setValue('passes')
    await click(wrapper, 'Antwort prüfen')
    await click(wrapper, 'Weiter')
    await wrapper.get('.coach-answer-input').setValue('Mein Satz.')
    await click(wrapper, 'Mit Musterlösung vergleichen')
    await click(wrapper, 'Passt zur Checkliste')
    await click(wrapper, 'Weiter')
    await click(wrapper, 'Einheit abschließen')
    await click(wrapper, 'Zur Lerncoach-Übersicht')
    await click(wrapper, '← Business English W3')

    const v2 = { ...withStep(coachLibraryData(), 't-choice', { explanation: 'NEUE ERKLAERUNG.' }), libraryVersion: 2 }
    const importer2 = wrapper.findComponent({ name: 'PrivateContentImporter' })
    await importer2.vm.$emit('coach-loaded', await importCoachFiles([jsonFile(v2, 'coach-v2.json')], importer2.props('currentCoach')))
    await flushPromises()
    await wrapper.get('.navigator-card-coach button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Inhalt aktualisiert (1 Schritt) – bitte wiederholen.')
    expect(getCoachUnitState('u1').steps['t-choice']).toMatchObject({ status: 'correct', revision: v1.units[0].steps[2].revision })

    await click(wrapper, 'Wiederholen')
    expect(wrapper.text()).toContain('Schritt 1 von 1')
    await click(wrapper, 'Right sentence one.')
    expect(wrapper.text()).toContain('NEUE ERKLAERUNG.')
  })
})

describe('Lerncoach: Audio (bestehender Player, per Tipp, langsam)', () => {
  async function appWithAudio() {
    const library = validateCoachLibrary(coachLibraryData())
    const items = library.units[0].steps.flatMap((step) => (step.type === 'examples' ? step.examples : [step]))
    const { pack } = await packFor(items)
    const { wrapper, importer } = await mountApp()
    await importer.vm.$emit('audio-pack-loaded', { pack, report: { loaded: [{ fileName: 'coach.zip', fileCount: pack.fileCount }], errors: [] } })
    await openCoach(wrapper)
    await startUnit(wrapper)
    await click(wrapper, 'Weiter')
    await vi.waitFor(() => expect(wrapper.findAll('.coach-example-audio')).toHaveLength(2))
    return wrapper
  }

  it('Beispielsaetze spielen nie von selbst, nur per Tipp; normal und langsam (0,75x); Wiederholen funktioniert', async () => {
    const wrapper = await appWithAudio()
    expect(audioElement.realPlays).toHaveLength(0)
    expect(wrapper.text()).not.toContain('kein Audio geladen')
    const rows = wrapper.findAll('.coach-example')
    await rows[0].get('[aria-label="Satz anhören"]').trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
    expect(audioElement.playedRates.at(-1)).toBe(1)
    await rows[0].get('[aria-label="Langsam"]').trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(2))
    expect(audioElement.playedRates.at(-1)).toBe(0.75)
    await rows[0].get('[aria-label="Satz anhören"]').trigger('click') // wiederholen: wieder normales Tempo
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(3))
    expect(audioElement.playedRates.at(-1)).toBe(1)
    await rows[1].get('[aria-label="Satz anhören"]').trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(4))
    expect(new Set(audioElement.realPlays).size).toBe(2) // zwei verschiedene Saetze -> zwei verschiedene Dateien
  })

  it('die globale Tempo-Einstellung gilt fuer normales Abspielen und wird von "langsam" nicht veraendert', async () => {
    const wrapper = await appWithAudio()
    await wrapper.get('#audio-playback-rate').setValue('1.1')
    await wrapper.get('.coach-example [aria-label="Satz anhören"]').trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
    expect(audioElement.playedRates.at(-1)).toBe(1.1)
    await wrapper.get('.coach-example [aria-label="Langsam"]').trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(2))
    expect(audioElement.playedRates.at(-1)).toBe(0.75)
    expect(JSON.parse(window.localStorage.getItem('businessEnglishAudio:v1')).playbackRate).toBe(1.1)
  })

  it('Choice/Gap: Frage ohne Loesung; Loesungs-Audio erst nach der Abgabe; Musterloesung-Audio erst nach dem Vergleich', async () => {
    const wrapper = await appWithAudio()
    await click(wrapper, 'Weiter') // Choice
    expect(wrapper.find('[aria-label="Richtige Antwort anhören"]').exists()).toBe(false)
    await click(wrapper, 'Right sentence one.')
    expect(wrapper.find('[aria-label="Richtige Antwort anhören"]').exists()).toBe(true)
    await click(wrapper, 'Weiter')
    await wrapper.get('.gap-answer-input').setValue('passes')
    await click(wrapper, 'Antwort prüfen')
    await click(wrapper, 'Weiter')
    expect(wrapper.find('[aria-label="Musterlösung anhören"]').exists()).toBe(false)
    await wrapper.get('.coach-answer-input').setValue('Mein Satz.')
    await click(wrapper, 'Mit Musterlösung vergleichen')
    expect(wrapper.find('[aria-label="Musterlösung anhören"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Musterlösung anhören"]').element.closest('.coach-compare')).not.toBeNull()
  })

  it('iPhone-relevant: die erste Beruehrung entsperrt das eine Audio-Element (kein AudioContext/speechSynthesis)', async () => {
    await appWithAudio()
    document.dispatchEvent(new Event('click'))
    expect(audioElement.src.startsWith('data:audio/wav')).toBe(true)
    for (const file of ['CoachRunner.vue', 'CoachExampleRow.vue', 'CoachProduceStep.vue', 'CoachUnitList.vue']) {
      expect(readFileSync(join(resolve(__dirname, '..'), file), 'utf8')).not.toMatch(/AudioContext|speechSynthesis|new Audio\(/)
    }
  })
})

describe('Lerncoach: Datenschutz im Quellcode', () => {
  function collect(dir) {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? (name === '__tests__' ? [] : collect(path)) : [path]
    })
  }

  it('Coach-Code nutzt weder IndexedDB, Cache API, Service Worker noch Netzwerk; einziger Speicher ist localStorage in coachStorage.js', () => {
    const files = collect(resolve(__dirname, '../..')).filter((path) => /(coach|Coach).*\.(js|vue)$/.test(path))
    expect(files.map((path) => path.split('/').pop()).sort()).toEqual(['CoachExampleRow.vue', 'CoachProduceStep.vue', 'CoachRunner.vue', 'CoachUnitList.vue', 'coachConflictMessage.js', 'coachImport.js', 'coachLibrary.js', 'coachStorage.js'])
    for (const path of files) {
      const content = readFileSync(path, 'utf8')
      expect(content, path).not.toMatch(/indexedDB|caches\.open|serviceWorker|fetch\(|XMLHttpRequest|sendBeacon/)
      if (!path.endsWith('coachStorage.js')) expect(content, path).not.toMatch(/localStorage|sessionStorage/)
    }
  })

  it('der Importvorgang schreibt nichts in den Browser-Speicher', async () => {
    window.localStorage.clear()
    await mountApp()
    expect(window.localStorage.length).toBe(0)
  })
})

describe('Lerncoach: Konfliktmeldung nennt die richtige Ursache', () => {
  const other = () => jsonFile({ ...coachLibraryData(), libraryId: 'andere-coach-bibliothek' }, 'andere.json')
  const variantB = () => jsonFile(withStep(coachLibraryData(), 't-explain', { title: 'Variante B' }), 'B.json')
  const conflictLines = (wrapper) => wrapper.findAll('[aria-label="Lerncoach-Bericht"] .feedback-wrong').map((line) => line.text())
  async function importMore(wrapper, files) {
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
    await importer.vm.$emit('coach-loaded', await importCoachFiles(files, importer.props('currentCoach')))
    await flushPromises()
  }

  it('verschiedene Bibliotheks-IDs im Batch ohne geladene Bibliothek: ID-Meldung, keine Inhalts-Meldung', async () => {
    const { wrapper } = await mountApp({ coach: null })
    await importMore(wrapper, [jsonFile(coachLibraryData(), 'A.json'), other()])
    const lines = conflictLines(wrapper)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line).toContain('unterschiedliche Bibliotheks-ID')
      expect(line).not.toContain('gleiche Bibliothek und Version')
      expect(line).toContain('Keine dieser Dateien wird verwendet.')
    }
  })

  it('gleiche Bibliothek und Version mit anderem Inhalt: Inhalts-Meldung, keine ID-Meldung', async () => {
    const { wrapper } = await mountApp({ coach: null })
    await importMore(wrapper, [jsonFile(coachLibraryData(), 'A.json'), variantB()])
    const lines = conflictLines(wrapper)
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line).toContain('gleiche Bibliothek und Version, aber unterschiedlicher Inhalt')
      expect(line).not.toContain('Bibliotheks-ID')
    }
  })

  it('geladene Bibliothek + Batch mit verschiedenen IDs: ID-Meldung, geladene Bibliothek bleibt aktiv', async () => {
    const { wrapper } = await mountApp()
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
    await importMore(wrapper, [jsonFile({ ...coachLibraryData(), libraryId: 'x-1' }, 'x1.json'), jsonFile({ ...coachLibraryData(), libraryId: 'x-2' }, 'x2.json')])
    const lines = conflictLines(wrapper)
    expect(lines).toHaveLength(2)
    expect(lines.every((line) => line.includes('Bibliotheks-ID') && line.includes('bleibt aktiv'))).toBe(true)
    expect(importer.props('currentCoach').entry).not.toBeNull()
  })

  it('geladene Bibliothek + einzelne Datei mit anderer ID: ID-Meldung, bisherige Bibliothek wird als deaktiviert gemeldet', async () => {
    const { wrapper } = await mountApp()
    await importMore(wrapper, [other()])
    const lines = conflictLines(wrapper)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('unterschiedliche Bibliotheks-ID')
    expect(lines[0]).toContain('wurde wegen des Konflikts deaktiviert')
    expect(lines[0]).not.toContain('bleibt aktiv')
    expect(lines[0]).not.toContain('gleiche Bibliothek und Version')
  })

  it('geladene Bibliothek + einzelne Datei gleicher Version mit anderem Inhalt: Inhalts-Meldung, bisherige Bibliothek deaktiviert', async () => {
    const { wrapper } = await mountApp()
    await importMore(wrapper, [variantB()])
    const lines = conflictLines(wrapper)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('gleiche Bibliothek und Version, aber unterschiedlicher Inhalt')
    expect(lines[0]).toContain('wurde wegen des Konflikts deaktiviert')
  })

  it('Sonderfall geladenes A + Batch A/B/A bleibt unveraendert: A ist Duplikat, B steht allein gegen A, A wird deaktiviert (Konflikt-Zustand)', async () => {
    const { wrapper } = await mountApp()
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
    const result = await importCoachFiles([jsonFile(coachLibraryData(), 'A1.json'), variantB(), jsonFile(coachLibraryData(), 'A2.json')], importer.props('currentCoach'))
    expect(result.entry).toBeNull()
    expect(result.conflict).toMatchObject({ reason: 'same-version-different-fingerprint' })
    expect(result.report.conflicts.map((entry) => entry.fileName)).toEqual(['B.json'])
    expect(result.report.conflicts[0].keptExisting).toBe(false)
    expect(result.report.duplicates.map((entry) => entry.fileName).sort()).toEqual(['A1.json', 'A2.json'])
    await importer.vm.$emit('coach-loaded', result)
    await flushPromises()
    expect(conflictLines(wrapper)).toEqual([expect.stringContaining('wurde wegen des Konflikts deaktiviert')])
  })
})
