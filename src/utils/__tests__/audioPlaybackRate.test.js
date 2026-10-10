import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App.vue'
import ChoiceCard from '../../components/ChoiceCard.vue'
import { AUDIO_CONTROLLER_KEY } from '../audioController.js'
import {
  AUDIO_SETTINGS_KEY, DEFAULT_PLAYBACK_RATE, PLAYBACK_RATE_MAX, PLAYBACK_RATE_MIN, PLAYBACK_RATE_STEP,
  formatPlaybackRate, loadAudioSettings, parsePlaybackRate,
} from '../audioSettings.js'
import { getItemStatus } from '../progressStorage.js'
import { FakeAudio, choiceItem, createTestController, installObjectUrlStub, packFor } from './audioTestHelpers.js'

const ALLOWED_RATES = [0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2]
const Q_LABEL = '[aria-label="Frage anhören"]'
const SOLUTION_LABEL = '[aria-label="Richtige Antwort anhören"]'
const stored = () => JSON.parse(window.localStorage.getItem(AUDIO_SETTINGS_KEY))

beforeEach(() => {
  window.localStorage.clear()
  installObjectUrlStub()
})

describe('Sprechtempo - Einstellungsmodell', () => {
  it('Test A: Default ist 1.0 (ohne gespeicherte Einstellung und nach Defekt)', () => {
    expect(DEFAULT_PLAYBACK_RATE).toBe(1)
    expect(loadAudioSettings().playbackRate).toBe(1)
    window.localStorage.setItem(AUDIO_SETTINGS_KEY, '{kaputt')
    expect(loadAudioSettings()).toEqual({ audioEnabled: true, autoPlay: true, playbackRate: 1 })
  })

  it('Test B: gueltiger gespeicherter Wert (0.9) wird geladen, Booleans bleiben unberuehrt', () => {
    window.localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ audioEnabled: false, autoPlay: true, playbackRate: 0.9 }))
    expect(loadAudioSettings()).toEqual({ audioEnabled: false, autoPlay: true, playbackRate: 0.9 })
  })

  it('Test B2: alte Einstellung ohne playbackRate (nur Booleans) laedt mit Default 1.0', () => {
    window.localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ audioEnabled: false, autoPlay: false }))
    expect(loadAudioSettings()).toEqual({ audioEnabled: false, autoPlay: false, playbackRate: 1 })
  })

  it.each([2.0, 0.5, 1.25, 0.77, 0, -1, '0.9', null, true, [], {}, NaN])('Test C: ungueltiger Wert %j faellt auf 1.0 zurueck', (bad) => {
    window.localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ audioEnabled: true, autoPlay: true, playbackRate: bad }))
    expect(loadAudioSettings().playbackRate).toBe(1)
  })

  it('Test D/E/F: Bereich 0.75-1.20 in 0.05er-Schritten; genau die zehn erlaubten Werte', () => {
    expect(PLAYBACK_RATE_MIN).toBe(0.75)
    expect(PLAYBACK_RATE_MAX).toBe(1.2)
    expect(PLAYBACK_RATE_STEP).toBe(0.05)
    const accepted = []
    for (let value = 0.5; value <= 1.5001; value += 0.01) {
      const rounded = Math.round(value * 100) / 100
      if (parsePlaybackRate(rounded) !== null) accepted.push(rounded)
    }
    expect(accepted).toEqual(ALLOWED_RATES)
  })

  it('Anzeige mit Komma und zwei Dezimalstellen', () => {
    expect(formatPlaybackRate(0.75)).toBe('0,75×')
    expect(formatPlaybackRate(0.8)).toBe('0,80×')
    expect(formatPlaybackRate(1)).toBe('1,00×')
    expect(formatPlaybackRate(1.2)).toBe('1,20×')
  })
})

describe('Sprechtempo - Controller und Persistenz', () => {
  it('Test D/E/G: Regler akzeptiert 0.75 und 1.20 (auch als Range-Input-String) und speichert lokal', () => {
    const { controller } = createTestController()
    expect(controller.setPlaybackRate('0.75')).toBe(true)
    expect(controller.playbackRate.value).toBe(0.75)
    expect(stored().playbackRate).toBe(0.75)
    expect(controller.setPlaybackRate('1.2')).toBe(true)
    expect(controller.playbackRate.value).toBe(1.2)
    expect(stored().playbackRate).toBe(1.2)
  })

  it('Test F: Werte neben dem Raster oder ausserhalb werden ignoriert, der alte Wert bleibt', () => {
    const { controller } = createTestController()
    controller.setPlaybackRate(0.9)
    for (const bad of [0.7, 1.25, 0.77, 2, 0, 'abc', '', null, undefined]) expect(controller.setPlaybackRate(bad)).toBe(false)
    expect(controller.playbackRate.value).toBe(0.9)
    expect(stored().playbackRate).toBe(0.9)
  })

  it('Test K/L: Tempo aendert Audio An/Aus und Auto-Vorlesen nicht - und umgekehrt', () => {
    const { controller } = createTestController({ audioEnabled: true, autoPlay: false })
    controller.setPlaybackRate(1.1)
    expect([controller.audioEnabled.value, controller.autoPlay.value]).toEqual([true, false])
    controller.setAudioEnabled(false)
    controller.setAutoPlay(true)
    expect(controller.playbackRate.value).toBe(1.1)
    expect(stored()).toEqual({ audioEnabled: false, autoPlay: true, playbackRate: 1.1 })
  })

  it('beim Start wird das gespeicherte Tempo uebernommen', () => {
    const { controller } = createTestController({ playbackRate: 0.85 })
    expect(controller.playbackRate.value).toBe(0.85)
  })
})

describe('Sprechtempo - Wiedergabe (Frage, Loesung, Replay, Autoplay)', () => {
  const global = (controller) => ({ provide: { [AUDIO_CONTROLLER_KEY]: controller } })
  const props = (overrides = {}) => ({ item: choiceItem, selectedAnswer: null, isAnswered: false, isLastItem: false, ...overrides })

  async function mountWithRate(rate, settings = {}) {
    const { controller, audioElement } = createTestController({ playbackRate: rate, ...settings })
    controller.setPack((await packFor([choiceItem])).pack)
    const wrapper = mount(ChoiceCard, { props: props(), global: global(controller) })
    return { controller, audioElement, wrapper }
  }

  it('Test H: Frage (Autoplay) nutzt das Tempo - trotz Reset durch neue Quelle', async () => {
    const { audioElement } = await mountWithRate(0.9)
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
    expect(audioElement.playedRates).toEqual([0.9])
    expect(audioElement.defaultPlaybackRate).toBe(0.9)
  })

  it('Test I: Loesung nutzt dasselbe Tempo (bei falscher Antwort die richtige Loesung)', async () => {
    const { audioElement, wrapper } = await mountWithRate(1.15)
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
    await wrapper.setProps({ isAnswered: true, selectedAnswer: 'WRONG-OPTION-ONE yeah what' })
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(2))
    expect(audioElement.playedRates).toEqual([1.15, 1.15])
  })

  it('Test J: 🔊-Replay nutzt das Tempo (Frage und Loesung), auch ohne Autoplay', async () => {
    const { audioElement, wrapper } = await mountWithRate(0.8, { autoPlay: false })
    await vi.waitFor(() => expect(wrapper.find(Q_LABEL).exists()).toBe(true))
    await wrapper.get(Q_LABEL).trigger('click')
    await wrapper.get(Q_LABEL).trigger('click')
    await wrapper.setProps({ isAnswered: true, selectedAnswer: choiceItem.correctAnswer })
    await vi.waitFor(() => expect(wrapper.find(SOLUTION_LABEL).exists()).toBe(true))
    await wrapper.get(SOLUTION_LABEL).trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(3))
    expect(audioElement.playedRates).toEqual([0.8, 0.8, 0.8])
  })

  it('Live-Aenderung: laufende Wiedergabe passt sich sofort an, die naechste nutzt den neuen Wert', async () => {
    const { controller, audioElement, wrapper } = await mountWithRate(1)
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
    expect(audioElement.paused).toBe(false)

    controller.setPlaybackRate(0.75)
    expect(audioElement.playbackRate).toBe(0.75) // sofort, ohne Neustart
    expect(audioElement.paused).toBe(false)

    await wrapper.get(Q_LABEL).trigger('click')
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(2))
    expect(audioElement.playedRates).toEqual([1, 0.75])
  })

  it('loadedmetadata (Safari-Reset) stellt das Tempo wieder her', async () => {
    const { controller, audioElement } = await mountWithRate(0.95)
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
    audioElement.playbackRate = 1 // Browser setzt zurueck
    for (const handler of audioElement.listeners.loadedmetadata ?? []) handler()
    expect(audioElement.playbackRate).toBe(0.95)
    expect(controller.playbackRate.value).toBe(0.95)
  })
})

describe('Sprechtempo - Regler in der App', () => {
  const library = {
    areaId: 'telephoning', areaTitle: 'Business Telephoning',
    lessons: [{ lessonId: 'l1', lessonTitle: 'L1', scenarios: [{ scenarioId: 's1', scenarioTitle: 'S1', items: [choiceItem] }] }],
  }
  const registry = { libraryByAreaId: { telephoning: { library } }, conflictsByAreaId: {}, report: { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] } }
  let audioElement

  beforeEach(() => {
    audioElement = new FakeAudio()
    vi.stubGlobal('Audio', function FakeAudioCtor() { return audioElement })
  })
  afterEach(() => vi.unstubAllGlobals())

  async function loadApp({ stubChoice = true } = {}) {
    const wrapper = shallowMount(App, { global: { stubs: stubChoice ? {} : { ChoiceCard: false, AudioButton: false } } })
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
    await importer.vm.$emit('libraries-loaded', registry)
    const { pack } = await packFor([choiceItem])
    await importer.vm.$emit('audio-pack-loaded', { pack, report: { loaded: [{ fileName: pack.fileName, fileCount: pack.fileCount }], errors: [] } })
    return wrapper
  }

  it('Regler ist ein Range-Input mit min 0.75, max 1.20, step 0.05, Default 1.00 und sauberem Label', async () => {
    const wrapper = await loadApp()
    const slider = wrapper.get('input[type="range"]')
    expect(slider.attributes()).toMatchObject({ min: '0.75', max: '1.2', step: '0.05' })
    expect(slider.element.value).toBe('1')
    expect(slider.attributes('aria-valuetext')).toBe('1,00×')
    const label = wrapper.get('label[for="audio-playback-rate"]')
    expect(label.text()).toBe('Sprechtempo: 1,00×')
    expect(wrapper.get('.audio-rate-control').text()).toContain('0,75×')
    expect(wrapper.get('.audio-rate-control').text()).toContain('1,20×')
  })

  it('Test D/E/G: Verschieben auf 0.75 und 1.20 aktualisiert Anzeige und Speicher', async () => {
    const wrapper = await loadApp()
    const slider = wrapper.get('input[type="range"]')
    await slider.setValue('0.75')
    expect(wrapper.get('.audio-rate-label').text()).toBe('Sprechtempo: 0,75×')
    expect(stored().playbackRate).toBe(0.75)
    await slider.setValue('1.2')
    expect(wrapper.get('.audio-rate-label').text()).toBe('Sprechtempo: 1,20×')
    expect(stored().playbackRate).toBe(1.2)
    await slider.setValue('0.9')
    expect(wrapper.get('.audio-rate-label').text()).toBe('Sprechtempo: 0,90×')
  })

  it('gespeichertes Tempo erscheint nach "Neustart" der App im Regler', async () => {
    window.localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ audioEnabled: true, autoPlay: true, playbackRate: 1.05 }))
    const wrapper = await loadApp()
    expect(wrapper.get('input[type="range"]').element.value).toBe('1.05')
    expect(wrapper.get('.audio-rate-label').text()).toBe('Sprechtempo: 1,05×')
  })

  it('ohne Audio-Pack gibt es keinen Regler (wie bei den anderen Audio-Einstellungen)', () => {
    const wrapper = shallowMount(App)
    expect(wrapper.find('input[type="range"]').exists()).toBe(false)
  })

  it('Test M/N + Privacy: Tempo aendert Fortschritt nicht (1 Submit = 1 Versuch); localStorage enthaelt nur die drei Einstellungen', async () => {
    const wrapper = await loadApp({ stubChoice: false })
    const navigator = () => wrapper.findAllComponents({ name: 'LearningNavigator' })[0]
    await navigator().vm.$emit('open-area', 'telephoning')
    await navigator().vm.$emit('open-lesson', 'l1')
    await navigator().vm.$emit('start-scenario', 's1')
    await vi.waitFor(() => expect(audioElement.realPlays.length).toBe(1))

    await wrapper.get('input[type="range"]').setValue('0.85')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', choiceItem.correctAnswer)
    await vi.waitFor(() => expect(audioElement.realPlays.length).toBe(2)) // Frage + Loesung
    expect(audioElement.playedRates).toEqual([1, 0.85]) // Frage lief mit 1.0, Loesung mit dem neuen Tempo
    await flushPromises()

    expect(getItemStatus('telephoning', 'tel-test-01')).toMatchObject({ status: 'correct', attempts: 1 })
    expect(Object.keys(stored()).sort()).toEqual(['audioEnabled', 'autoPlay', 'playbackRate'])
    expect(Object.keys(window.localStorage).sort()).toEqual([AUDIO_SETTINGS_KEY, 'businessEnglishProgress:v2'])
    expect(JSON.stringify(Object.values({ ...window.localStorage }))).not.toMatch(/blob:|\.mp3|audio\/mpeg|Kim speaking|WRONG-OPTION|Support Team/)
  })
})
