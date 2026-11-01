import { flushPromises, shallowMount } from '@vue/test-utils'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter, configure } from '@zip.js/zip.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App.vue'
import { loadAudioPacks } from '../audioPack.js'
import { getItemStatus } from '../progressStorage.js'
import { FakeAudio, choiceItem, installObjectUrlStub, packFor } from './audioTestHelpers.js'

configure({ useWebWorkers: false })

const library = {
  areaId: 'telephoning', areaTitle: 'Business Telephoning',
  lessons: [{ lessonId: 'l1', lessonTitle: 'L1', scenarios: [{ scenarioId: 's1', scenarioTitle: 'S1', items: [choiceItem] }] }],
}
const registry = { libraryByAreaId: { telephoning: { library } }, conflictsByAreaId: {}, report: { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] } }

async function makeZip(entries, name) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 })
  for (const [entryName, data] of Object.entries(entries)) await writer.add(entryName, new Uint8ArrayReader(data))
  return new File([await writer.close()], name, { type: 'application/zip' })
}

describe('Audio-Pack Reimport: Zustand und UI bleiben konsistent', () => {
  let audioElement

  beforeEach(() => {
    window.localStorage.clear()
    installObjectUrlStub()
    audioElement = new FakeAudio()
    vi.stubGlobal('Audio', function FakeAudioCtor() { return audioElement })
  })
  afterEach(() => vi.unstubAllGlobals())

  async function appWithValidPack() {
    const wrapper = shallowMount(App, { global: { stubs: { ChoiceCard: false, AudioButton: false } } })
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
    await importer.vm.$emit('libraries-loaded', registry)
    const { pack } = await packFor([choiceItem])
    await importer.vm.$emit('audio-pack-loaded', { pack, report: { loaded: [{ fileName: pack.fileName, fileCount: pack.fileCount }], errors: [] } })
    return { wrapper, importer, pack }
  }

  const navigator = (wrapper) => wrapper.findAllComponents({ name: 'LearningNavigator' })[0]
  const startLearning = async (wrapper) => {
    await navigator(wrapper).vm.$emit('open-area', 'telephoning')
    await navigator(wrapper).vm.$emit('open-lesson', 'l1')
    await navigator(wrapper).vm.$emit('start-scenario', 's1')
  }

  it('gueltiger Pack -> defektes ZIP: alter Pack bleibt aktiv, UI sagt es, Fehlermeldung korrekt, Lernen laeuft weiter', async () => {
    const { wrapper, importer, pack } = await appWithValidPack()
    const loadedLine = `Audio-Pack geladen: ${pack.fileName} (${pack.fileCount} Audio-Dateien)`
    expect(wrapper.text()).toContain(loadedLine)

    const broken = new File([new Uint8Array(64).fill(7)], 'kaputt.zip', { type: 'application/zip' })
    const realPayload = await loadAudioPacks([broken]) // echter Importer-Weg, kein handgebautes Fehlerobjekt
    expect(realPayload.pack).toBeNull()
    await importer.vm.$emit('audio-pack-loaded', realPayload)

    // alter Pack bleibt tatsaechlich aktiv ...
    expect(wrapper.find('.audio-settings').exists()).toBe(true)
    // ... und die UI sagt genau das
    expect(wrapper.text()).toContain(loadedLine)
    expect(wrapper.text()).toContain('Audio-Pack kaputt.zip: Audio-Pack konnte nicht gelesen werden (ZIP defekt?). Der bisher geladene Audio-Pack bleibt aktiv.')
    expect(wrapper.text()).not.toContain('nur ohne Audio')

    // Libraries unveraendert, Lernen funktioniert, Audio kommt aus dem alten Pack
    expect(navigator(wrapper).props('libraryByAreaId')).toHaveProperty('telephoning')
    await startLearning(wrapper)
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1)) // Frage aus altem Pack
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', choiceItem.correctAnswer)
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(2)) // Loesung aus altem Pack
    expect(getItemStatus('telephoning', 'tel-test-01')).toMatchObject({ status: 'correct', attempts: 1 })
  })

  it('Duplicate-ZIP als Reimport: gleiche Garantien, Fehlertext nennt die doppelten Namen als Ursache', async () => {
    const { wrapper, importer, pack } = await appWithValidPack()
    const dup = await makeZip({ 'one/a__x__q__11111111.mp3': new Uint8Array([1]), 'two/a__x__q__11111111.mp3': new Uint8Array([2]) }, 'dup.zip')
    await importer.vm.$emit('audio-pack-loaded', await loadAudioPacks([dup]))
    expect(wrapper.find('.audio-settings').exists()).toBe(true)
    expect(wrapper.text()).toContain(`Audio-Pack geladen: ${pack.fileName}`)
    expect(wrapper.text()).toContain('Audio-Pack dup.zip: Audio-Pack ungültig: 1 doppelte Audio-Dateinamen im ZIP. Der bisher geladene Audio-Pack bleibt aktiv.')
  })

  // Auftrag 035: ein zweites, anderes ZIP (z. B. Lerncoach-Audio) ergaenzt das aktive Pack, statt es zu ersetzen.
  it('gueltiger zweiter Import mit anderem ZIP ergaenzt den alten Pack (beide in der UI, keine Ersetzung)', async () => {
    const { wrapper, importer, pack } = await appWithValidPack()
    const next = await makeZip({ 'b__y__q__33333333.mp3': new Uint8Array([3]) }, 'neu.zip')
    await importer.vm.$emit('audio-pack-loaded', await loadAudioPacks([next]))
    await flushPromises()
    expect(wrapper.text()).toContain('Audio-Pack geladen: neu.zip (1 Audio-Dateien)')
    expect(wrapper.text()).toContain(`Audio-Pack geladen: ${pack.fileName}`)
    expect(wrapper.text()).not.toContain('Dieses ZIP wird nicht verwendet.')
    // das alte Audio laeuft weiter
    await startLearning(wrapper)
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
  })

  it('dasselbe ZIP (gleicher Dateiname) erneut gewaehlt ersetzt sein altes Gegenstueck und wird nicht doppelt gelistet', async () => {
    const { wrapper, importer } = await appWithValidPack()
    const first = await makeZip({ 'b__y__q__33333333.mp3': new Uint8Array([3]) }, 'neu.zip')
    await importer.vm.$emit('audio-pack-loaded', await loadAudioPacks([first]))
    const again = await makeZip({ 'b__y__q__33333333.mp3': new Uint8Array([3]), 'b__y__s__44444444.mp3': new Uint8Array([4]) }, 'neu.zip')
    await importer.vm.$emit('audio-pack-loaded', await loadAudioPacks([again]))
    await flushPromises()
    expect(wrapper.text()).toContain('Audio-Pack geladen: neu.zip (2 Audio-Dateien)')
    expect(wrapper.text()).not.toContain('Audio-Pack geladen: neu.zip (1 Audio-Dateien)')
    expect(wrapper.text()).toContain('Audio-Pack geladen: business-english-audio-v1.zip')
  })

  it('kollidierende Audio-Dateinamen mit einem anderen geladenen Pack: nichts wird ueberschrieben, Kollision wird gemeldet, alter Pack bleibt aktiv', async () => {
    const { wrapper, importer, pack } = await appWithValidPack()
    const clashName = pack.names()[0]
    const clash = await makeZip({ [clashName]: new Uint8Array([9]) }, 'konflikt.zip')
    await importer.vm.$emit('audio-pack-loaded', await loadAudioPacks([clash]))
    await flushPromises()
    expect(wrapper.text()).toContain('Audio-Pack konflikt.zip: Audio-Pack ungültig: Audio-Dateinamen kommen auch in einem bereits geladenen Pack vor. Der bisher geladene Audio-Pack bleibt aktiv.')
    expect(wrapper.text()).toContain(`Audio-Pack geladen: ${pack.fileName}`)
    expect(wrapper.text()).not.toContain('Audio-Pack geladen: konflikt.zip')
    await startLearning(wrapper)
    await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
  })

  it('ohne vorherigen Pack bleibt die bisherige Meldung (kein Audio, Libraries ok)', async () => {
    const wrapper = shallowMount(App)
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
    await importer.vm.$emit('libraries-loaded', registry)
    const broken = new File([new Uint8Array(64).fill(7)], 'kaputt.zip', { type: 'application/zip' })
    await importer.vm.$emit('audio-pack-loaded', await loadAudioPacks([broken]))
    expect(wrapper.find('.audio-settings').exists()).toBe(false)
    expect(wrapper.text()).toContain('Audio-Pack kaputt.zip: Audio-Pack konnte nicht gelesen werden (ZIP defekt?). Die Lernbibliotheken funktionieren trotzdem, nur ohne Audio.')
    expect(navigator(wrapper).props('libraryByAreaId')).toHaveProperty('telephoning')
  })

  it('ein gueltiger Pack plus ein defektes ZIP im selben Import: gueltiger Pack aktiv, defektes wird gemeldet', async () => {
    const wrapper = shallowMount(App)
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
    await importer.vm.$emit('libraries-loaded', registry)
    const good = await makeZip({ 'a__x__q__11111111.mp3': new Uint8Array([1]) }, 'gut.zip')
    const broken = new File([new Uint8Array(64).fill(7)], 'kaputt.zip', { type: 'application/zip' })
    await importer.vm.$emit('audio-pack-loaded', await loadAudioPacks([good, broken]))
    expect(wrapper.find('.audio-settings').exists()).toBe(true)
    expect(wrapper.text()).toContain('Audio-Pack geladen: gut.zip (1 Audio-Dateien)')
    expect(wrapper.text()).toContain('Audio-Pack kaputt.zip:')
    expect(wrapper.text()).toContain('Dieses ZIP wird nicht verwendet.')
  })
})
