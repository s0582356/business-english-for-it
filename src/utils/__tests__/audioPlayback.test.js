import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App.vue'
import ChoiceCard from '../../components/ChoiceCard.vue'
import GapInputTrainer from '../../components/GapInputTrainer.vue'
import OrderedStepsTrainer from '../../components/OrderedStepsTrainer.vue'
import { AUDIO_CONTROLLER_KEY } from '../audioController.js'
import { getItemStatus } from '../progressStorage.js'
import {
  FakeAudio, blobForSource, choiceItem, createFakePack, createTestController, gapItem, installObjectUrlStub,
  orderedDialogItem, orderedStructureItem, packFor,
} from './audioTestHelpers.js'

const Q_LABEL = '[aria-label="Frage anhören"]'
const SOLUTION_LABEL = '[aria-label="Richtige Antwort anhören"]'

function bytesOf(blob) {
  return blob.arrayBuffer().then((buffer) => [...new Uint8Array(buffer)])
}

async function setup(items, { settings, kinds, extra } = {}) {
  const { controller, audioElement } = createTestController(settings)
  const { pack, files, names } = await packFor(items, { kinds, extra })
  controller.setPack(pack)
  return { controller, audioElement, pack, files, names }
}

const global = (controller) => ({ provide: { [AUDIO_CONTROLLER_KEY]: controller } })
const choiceProps = (overrides = {}) => ({ item: choiceItem, selectedAnswer: null, isAnswered: false, isLastItem: false, ...overrides })

beforeEach(() => {
  window.localStorage.clear()
  installObjectUrlStub()
})

describe('Choice - Audio UX', () => {
  it('Test 12: Frage startet automatisch und ist ueber 🔊 wiederholbar', async () => {
    const { controller, audioElement } = await setup([choiceItem])
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })

    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
    expect(await bytesOf(blobForSource(audioElement.realPlays[0]))).toEqual([1, 2, 3, 4]) // Frage

    await wrapper.get(Q_LABEL).trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(2))
    expect(await bytesOf(blobForSource(audioElement.realPlays[1]))).toEqual([1, 2, 3, 4])
  })

  it('Test 13: vor der Abgabe gibt es keinen Loesungs-Button und die Loesung wird nie abgespielt', async () => {
    const { controller, audioElement, names } = await setup([choiceItem], { settings: { autoPlay: false } })
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(wrapper.find(Q_LABEL).exists()).toBe(true))
    await wrapper.get(Q_LABEL).trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))

    expect(wrapper.find(SOLUTION_LABEL).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Richtige Antwort anhören')
    for (const src of audioElement.realPlays) expect(await bytesOf(blobForSource(src))).not.toEqual([1, 2, 3, 5])
    expect(names[0].s).toBeTruthy()
  })

  it('Test 14: nach der Abgabe erscheint der Loesungs-Button und die RICHTIGE Loesung wird gesprochen (auch bei falscher Antwort)', async () => {
    const { controller, audioElement } = await setup([choiceItem])
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1)) // Frage

    await wrapper.setProps({ isAnswered: true, selectedAnswer: 'WRONG-OPTION-ONE yeah what' })
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(2))
    expect(await bytesOf(blobForSource(audioElement.realPlays[1]))).toEqual([1, 2, 3, 5]) // Loesung, nicht die falsche Option

    const button = wrapper.get(SOLUTION_LABEL)
    await button.trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(3))
    expect(await bytesOf(blobForSource(audioElement.realPlays[2]))).toEqual([1, 2, 3, 5])
  })

  it('falsche Antwortoptionen haben nie einen 🔊-Button', async () => {
    const { controller } = await setup([choiceItem])
    const wrapper = mount(ChoiceCard, { props: choiceProps({ isAnswered: true, selectedAnswer: choiceItem.correctAnswer }), global: global(controller) })
    await flushPromises()
    for (const option of wrapper.findAll('.answer-button')) {
      expect(option.find('.audio-button').exists()).toBe(false)
      expect(option.text()).not.toContain('🔊')
    }
  })

  it('Test 15: Auto-Vorlesen aus -> nichts startet automatisch, 🔊 funktioniert weiter', async () => {
    const { controller, audioElement } = await setup([choiceItem], { settings: { autoPlay: false } })
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(wrapper.find(Q_LABEL).exists()).toBe(true))
    await wrapper.setProps({ isAnswered: true, selectedAnswer: choiceItem.correctAnswer })
    await flushPromises()
    expect(audioElement.realPlays).toHaveLength(0)

    await wrapper.get(SOLUTION_LABEL).trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
  })

  it('Test 16: Audio aus -> nichts spielt, keine 🔊-Buttons', async () => {
    const { controller, audioElement } = await setup([choiceItem], { settings: { audioEnabled: false } })
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await flushPromises()
    await wrapper.setProps({ isAnswered: true, selectedAnswer: choiceItem.correctAnswer })
    await flushPromises()
    expect(audioElement.realPlays).toHaveLength(0)
    expect(wrapper.find('.audio-button').exists()).toBe(false)
  })

  it('Audio ausschalten waehrend es laeuft, stoppt es sofort', async () => {
    const { controller, audioElement } = await setup([choiceItem])
    mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(audioElement.paused).toBe(false))
    controller.setAudioEnabled(false)
    expect(audioElement.paused).toBe(true)
  })

  it('Test 18: Itemwechsel stoppt das alte Audio und startet nur die neue Frage', async () => {
    const second = { ...choiceItem, id: 'tel-test-02', itemId: 'tel-test-02', prompt: 'A second question for the same card?' }
    const silent = { ...choiceItem, id: 'tel-test-03', itemId: 'tel-test-03', prompt: 'A third question without any audio file.' }
    const { controller, audioElement } = await setup([choiceItem, second])
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
    const firstSource = audioElement.realPlays[0]

    await wrapper.setProps({ item: second })
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(2))
    expect(audioElement.realPlays[1]).not.toBe(firstSource)

    await wrapper.setProps({ item: silent }) // Item ohne Audio: altes Audio muss trotzdem enden
    await flushPromises()
    expect(audioElement.paused).toBe(true)
    expect(audioElement.realPlays).toHaveLength(2)
    expect(wrapper.find('.audio-button').exists()).toBe(false)
  })

  it('Unmount stoppt das Audio', async () => {
    const { controller, audioElement } = await setup([choiceItem])
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(audioElement.paused).toBe(false))
    wrapper.unmount()
    expect(audioElement.paused).toBe(true)
  })

  it('Test 19: Mehrfachklick auf 🔊 stapelt nicht - ein Element, jeder Klick startet von vorn', async () => {
    const created = vi.fn()
    window.localStorage.setItem('businessEnglishAudio:v1', JSON.stringify({ audioEnabled: true, autoPlay: false }))
    const audioElement = new FakeAudio()
    const { createAudioController } = await import('../audioController.js')
    const controller = createAudioController({ createAudio: () => { created(); return audioElement } })
    controller.setPack((await packFor([choiceItem])).pack)

    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(wrapper.find(Q_LABEL).exists()).toBe(true))
    const button = wrapper.get(Q_LABEL)
    audioElement.currentTime = 3
    await button.trigger('click')
    await button.trigger('click')
    await button.trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(3))

    expect(created).toHaveBeenCalledTimes(1)
    expect(audioElement.currentTime).toBe(0)
    expect(audioElement.paused).toBe(false)
  })

  it('Frage laeuft noch, waehrend die Antwort abgegeben wird: Frage wird durch die Loesung ersetzt', async () => {
    const { controller, audioElement } = await setup([choiceItem])
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
    await wrapper.setProps({ isAnswered: true, selectedAnswer: choiceItem.correctAnswer })
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(2))
    expect(audioElement.src).toBe(audioElement.realPlays[1])
  })

  it('Test 20: fehlende Audio-Datei blockiert das Lernen nicht (stumm, kein 🔊)', async () => {
    const { controller, audioElement } = await setup([choiceItem], { kinds: ['s'] }) // Frage fehlt im Pack
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wrapper.find(Q_LABEL).exists()).toBe(false)
    expect(audioElement.realPlays).toHaveLength(0)
    await wrapper.findAll('.answer-button')[0].trigger('click')
    expect(wrapper.emitted('select-answer')).toHaveLength(1)
  })

  it('Loesungs-Audio bewusst nicht im Pack: nach der Abgabe kein Loesungs-Button, Frage-Audio und Lernen laufen normal', async () => {
    const { controller, audioElement } = await setup([choiceItem], { kinds: ['q'] }) // nur Fragen-Audio im Pack
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1)) // Frage spielt
    await wrapper.setProps({ isAnswered: true, selectedAnswer: choiceItem.correctAnswer })
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wrapper.find(SOLUTION_LABEL).exists()).toBe(false)
    expect(wrapper.find(Q_LABEL).exists()).toBe(true)
    expect(audioElement.realPlays).toHaveLength(1) // keine Loesung gesprochen
    expect(wrapper.text()).toContain('Richtig.')
  })

  it('Test 21a: defekte Datei im ZIP (Lesefehler) blockiert nichts', async () => {
    const { controller, audioElement, names } = await setup([choiceItem])
    const broken = createFakePack({ [names[0].q]: new Error('CRC'), [names[0].s]: new Uint8Array([1, 2, 3, 5]) })
    controller.setPack(broken)
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(wrapper.find(Q_LABEL).exists()).toBe(false))
    expect(audioElement.realPlays).toHaveLength(0)
    await wrapper.findAll('.answer-button')[0].trigger('click')
    expect(wrapper.emitted('select-answer')).toHaveLength(1)
  })

  it('Test 21b: nicht dekodierbare Datei -> Fehler still, 🔊 verschwindet, Loesung funktioniert weiter', async () => {
    const { controller, audioElement } = await setup([choiceItem], { settings: { autoPlay: false } })
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(wrapper.find(Q_LABEL).exists()).toBe(true))
    await vi.waitFor(() => expect(URL.createObjectURL.mock.calls.length).toBeGreaterThanOrEqual(2))
    URL.createObjectURL.mock.results.forEach((result) => audioElement.failSources.add(result.value)) // alle Quellen "kaputt"

    await wrapper.get(Q_LABEL).trigger('click')
    await vi.waitFor(() => expect(wrapper.find(Q_LABEL).exists()).toBe(false))
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await wrapper.setProps({ isAnswered: true, selectedAnswer: choiceItem.correctAnswer })
    expect(wrapper.text()).toContain('Richtig.')
  })

  it('iOS blockiert Autoplay: kein Fehler, Hinweis-Flag, 🔊 bleibt verfuegbar', async () => {
    const { controller, audioElement } = await setup([choiceItem])
    audioElement.playError = Object.assign(new Error('not allowed'), { name: 'NotAllowedError' })
    const wrapper = mount(ChoiceCard, { props: choiceProps(), global: global(controller) })
    await vi.waitFor(() => expect(controller.autoplayBlocked.value).toBe(true))
    expect(wrapper.find(Q_LABEL).exists()).toBe(true)

    audioElement.playError = null
    await wrapper.get(Q_LABEL).trigger('click')
    await vi.waitFor(() => expect(controller.autoplayBlocked.value).toBe(false))
    expect(audioElement.realPlays).toHaveLength(1)
  })

  it('ohne Audio-Controller/Pack verhaelt sich die Karte exakt wie vorher', async () => {
    const wrapper = mount(ChoiceCard, { props: choiceProps({ isAnswered: true, selectedAnswer: choiceItem.correctAnswer }) })
    await flushPromises()
    expect(wrapper.find('.audio-button').exists()).toBe(false)
    expect(wrapper.find('.prompt-row h2').text()).toBe(choiceItem.prompt)
  })
})

describe('Gap - Audio UX', () => {
  it('Test 8/9 im UI: Frage-🔊 vor, Loesungs-🔊 erst nach dem Pruefen; falsche Nutzereingabe wird nie gesprochen', async () => {
    const { controller, audioElement } = await setup([gapItem], { settings: { autoPlay: false } })
    const wrapper = mount(GapInputTrainer, { props: { item: gapItem, isLastItem: false }, global: global(controller) })
    await vi.waitFor(() => expect(wrapper.find(Q_LABEL).exists()).toBe(true))
    expect(wrapper.find('[aria-label="Richtigen Satz anhören"]').exists()).toBe(false)

    await wrapper.get('input').setValue('GRUETZE-FALSCHE-EINGABE')
    await wrapper.get('.primary-button').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[aria-label="Richtigen Satz anhören"]').exists()).toBe(true))
    await wrapper.get('[aria-label="Richtigen Satz anhören"]').trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
    expect(await bytesOf(blobForSource(audioElement.realPlays[0]))).toEqual([1, 2, 3, 5])
    expect(wrapper.emitted('completed')).toEqual([[{ id: gapItem.id, correct: false }]])
  })

  it('Autoplay: Frage beim Erscheinen, Loesung direkt nach dem Pruefen', async () => {
    const { controller, audioElement } = await setup([gapItem])
    const wrapper = mount(GapInputTrainer, { props: { item: gapItem, isLastItem: false }, global: global(controller) })
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
    await wrapper.get('input').setValue('to')
    await wrapper.get('.primary-button').trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(2))
  })
})

describe('Ordered - Audio UX', () => {
  it('Test 10 im UI: Dialog bekommt Frage- und Loesungs-Audio', async () => {
    const { controller, audioElement } = await setup([orderedDialogItem], { settings: { autoPlay: false } })
    const wrapper = mount(OrderedStepsTrainer, { props: { item: orderedDialogItem, isLastItem: false }, global: global(controller) })
    await vi.waitFor(() => expect(wrapper.find(Q_LABEL).exists()).toBe(true))
    expect(wrapper.find('[aria-label="Richtige Reihenfolge anhören"]').exists()).toBe(false)
    await wrapper.get('.primary-button').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[aria-label="Richtige Reihenfolge anhören"]').exists()).toBe(true))
    await wrapper.get('[aria-label="Richtige Reihenfolge anhören"]').trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
  })

  it('Test 11 im UI: Strukturliste hat Frage-Audio, aber NIE Loesungs-Audio', async () => {
    const { controller, audioElement } = await setup([orderedStructureItem])
    const wrapper = mount(OrderedStepsTrainer, { props: { item: orderedStructureItem, isLastItem: false }, global: global(controller) })
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1)) // Frage per Autoplay
    await wrapper.get('.primary-button').trigger('click')
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wrapper.find('[aria-label="Richtige Reihenfolge anhören"]').exists()).toBe(false)
    expect(audioElement.realPlays).toHaveLength(1)
  })
})

describe('App - Audio-Integration', () => {
  const library = {
    areaId: 'telephoning', areaTitle: 'Business Telephoning',
    lessons: [{ lessonId: 'l1', lessonTitle: 'L1', scenarios: [{ scenarioId: 's1', scenarioTitle: 'S1', items: [choiceItem, { ...choiceItem, id: 'tel-test-02', itemId: 'tel-test-02', prompt: 'Second question without audio.' }] }] }],
  }
  const registry = { libraryByAreaId: { telephoning: { library } }, conflictsByAreaId: {}, report: { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] } }
  let audioElement

  beforeEach(() => {
    audioElement = new FakeAudio()
    vi.stubGlobal('Audio', function FakeAudioCtor() { return audioElement })
  })
  afterEach(() => vi.unstubAllGlobals())

  async function startApp({ withPack = true } = {}) {
    const wrapper = shallowMount(App, { global: { stubs: { ChoiceCard: false, AudioButton: false } } })
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
    await importer.vm.$emit('libraries-loaded', registry)
    if (withPack) {
      const { pack } = await packFor([choiceItem])
      await importer.vm.$emit('audio-pack-loaded', { pack, report: { loaded: [{ fileName: pack.fileName, fileCount: pack.fileCount }], errors: [] } })
    }
    const navigator = () => wrapper.findAllComponents({ name: 'LearningNavigator' })[0]
    await navigator().vm.$emit('open-area', 'telephoning')
    await navigator().vm.$emit('open-lesson', 'l1')
    await navigator().vm.$emit('start-scenario', 's1')
    return wrapper
  }

  it('Test 2 im UI: nach Laden zeigt der Importbericht das Audio-Pack und es gibt genau zwei Audio-Schalter', async () => {
    const wrapper = shallowMount(App)
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
    expect(wrapper.find('.audio-settings').exists()).toBe(false) // ohne Pack keine Audio-UI
    await importer.vm.$emit('libraries-loaded', registry)
    const { pack } = await packFor([choiceItem])
    await importer.vm.$emit('audio-pack-loaded', { pack, report: { loaded: [{ fileName: 'business-english-audio-v1.zip', fileCount: 2 }], errors: [] } })
    expect(wrapper.text()).toContain('Audio-Pack geladen: business-english-audio-v1.zip (2 Audio-Dateien)')
    expect(wrapper.findAll('.audio-settings .audio-toggle').map((button) => button.text())).toEqual(['🔊 Audio: An', 'Auto-Vorlesen: An'])
  })

  it('Test 3 im UI: defektes ZIP zeigt Audio-Fehler, Libraries bleiben nutzbar, kein Audio-Schalter', async () => {
    const wrapper = shallowMount(App)
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
    await importer.vm.$emit('libraries-loaded', registry)
    await importer.vm.$emit('audio-pack-loaded', { pack: null, report: { loaded: [], errors: [{ fileName: 'x.zip', reason: 'Audio-Pack konnte nicht gelesen werden (ZIP defekt?).' }] } })
    expect(wrapper.text()).toContain('Audio-Pack x.zip: Audio-Pack konnte nicht gelesen werden')
    expect(wrapper.find('.audio-settings').exists()).toBe(false)
    expect(wrapper.findAllComponents({ name: 'LearningNavigator' })[0].props('libraryByAreaId')).toHaveProperty('telephoning')
  })

  it('Einstellungen: Toggles aendern nur ihre Booleans und persistieren sie (Tempo bleibt 1)', async () => {
    const wrapper = await startApp()
    const [audioToggle, autoToggle] = wrapper.findAll('.audio-toggle')
    await autoToggle.trigger('click')
    expect(JSON.parse(window.localStorage.getItem('businessEnglishAudio:v1'))).toEqual({ audioEnabled: true, autoPlay: false, playbackRate: 1 })
    await audioToggle.trigger('click')
    expect(JSON.parse(window.localStorage.getItem('businessEnglishAudio:v1'))).toEqual({ audioEnabled: false, autoPlay: false, playbackRate: 1 })
    expect(wrapper.findAll('.audio-toggle')[1].attributes('disabled')).toBeDefined()
  })

  it('Test 17: Navigation (zurueck zur Szenarioansicht) stoppt das Audio', async () => {
    const wrapper = await startApp()
    await vi.waitFor(() => expect(audioElement.paused).toBe(false))
    await wrapper.get('.back-button').trigger('click')
    expect(audioElement.paused).toBe(true)
  })

  it('Test 22/23/24: Audio laesst Fortschritt unveraendert (1 Submit = 1 Versuch), speichert keine Audio-Daten', async () => {
    const wrapper = await startApp()
    await vi.waitFor(() => expect(audioElement.realPlays.length).toBeGreaterThan(0))
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', choiceItem.correctAnswer)
    await vi.waitFor(() => expect(audioElement.realPlays.length).toBe(2)) // Frage + Loesung

    expect(getItemStatus('telephoning', 'tel-test-01')).toMatchObject({ status: 'correct', attempts: 1 })
    await wrapper.get('.audio-button').trigger('click') // Wiederholen veraendert den Fortschritt nicht
    expect(getItemStatus('telephoning', 'tel-test-01').attempts).toBe(1)

    const stored = Object.fromEntries(Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)]))
    expect(Object.keys(stored).sort()).toEqual(['businessEnglishProgress:v2'].concat(stored['businessEnglishAudio:v1'] ? ['businessEnglishAudio:v1'] : []).sort())
    const everything = JSON.stringify(stored)
    expect(everything).not.toMatch(/blob:|\.mp3|audio\/mpeg|ID3|Kim speaking|WRONG-OPTION/)
  })

  it('naechstes Item ohne Audio: Weiter stoppt altes Audio, Lernen laeuft stumm weiter', async () => {
    const wrapper = await startApp()
    await vi.waitFor(() => expect(audioElement.realPlays.length).toBe(1))
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', choiceItem.correctAnswer)
    await vi.waitFor(() => expect(audioElement.realPlays.length).toBe(2))
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('next-item')
    await flushPromises()
    expect(audioElement.paused).toBe(true)
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).props('item').id).toBe('tel-test-02')
    expect(wrapper.find('.audio-button').exists()).toBe(false)
  })

  it('ohne ZIP funktioniert die App exakt wie bisher (keine Audio-UI, kein Audio-Zugriff)', async () => {
    const wrapper = await startApp({ withPack: false })
    await flushPromises()
    expect(wrapper.find('.audio-settings').exists()).toBe(false)
    expect(wrapper.find('.audio-button').exists()).toBe(false)
    expect(audioElement.realPlays).toHaveLength(0)
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', choiceItem.correctAnswer)
    expect(getItemStatus('telephoning', 'tel-test-01')).toMatchObject({ status: 'correct', attempts: 1 })
  })
})
