import { flushPromises, shallowMount } from '@vue/test-utils'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter, configure } from '@zip.js/zip.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App.vue'
import { createAudioController } from '../audioController.js'
import { loadAudioPacks } from '../audioPack.js'
import { FakeAudio, blobForSource, choiceItem, createFakePack, installObjectUrlStub, packFor } from './audioTestHelpers.js'

configure({ useWebWorkers: false })

// Auftrag 037 (Red-Team-Fund): ein kollidierendes ZIP darf unabhaengige gueltige ZIPs desselben Imports nicht blockieren.
async function makeZip(entries, name) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 })
  for (const [entryName, data] of Object.entries(entries)) await writer.add(entryName, new Uint8ArrayReader(data))
  return new File([await writer.close()], name, { type: 'application/zip' })
}

const CLASH = 'a__clash__q__11111111.mp3'
const GOOD = 'b__good__q__22222222.mp3'
const OTHER = 'c__other__q__33333333.mp3'
const bytesOf = (blob) => new Promise((resolve) => {
  const reader = new FileReader()
  reader.onload = () => resolve([...new Uint8Array(reader.result)])
  reader.readAsArrayBuffer(blob)
})

let audioElement
beforeEach(() => {
  window.localStorage.clear()
  installObjectUrlStub()
  audioElement = new FakeAudio()
  vi.stubGlobal('Audio', function FakeAudioCtor() { return audioElement })
})
afterEach(() => vi.unstubAllGlobals())

async function controllerWithBase() {
  const controller = createAudioController({ createAudio: () => audioElement })
  const { pack } = await loadAudioPacks([await makeZip({ [CLASH]: new Uint8Array([1]) }, 'base.zip')])
  controller.setPack(pack)
  return controller
}

// Spielt eine Datei ab und liefert ihre Bytes (null = nicht vorhanden / nicht abspielbar).
async function played(controller, name) {
  const before = audioElement.realPlays.length
  const ok = await controller.playFile(name)
  if (!ok || audioElement.realPlays.length === before) return null
  return bytesOf(blobForSource(audioElement.realPlays.at(-1)))
}

describe('Audio-Merge pro ZIP: bestehendes Pack + kollidierendes ZIP + gueltiges ZIP', () => {
  for (const [label, order] of [['Reihenfolge collision, good', ['collision', 'good']], ['umgekehrte Reihenfolge good, collision', ['good', 'collision']]]) {
    it(`${label}: collision.zip wird abgelehnt, good.zip ergaenzt, das Original bleibt unveraendert`, async () => {
      const controller = await controllerWithBase()
      const zips = {
        collision: await makeZip({ [CLASH]: new Uint8Array([99]) }, 'collision.zip'),
        good: await makeZip({ [GOOD]: new Uint8Array([7]) }, 'good.zip'),
      }
      const { pack, report } = await loadAudioPacks(order.map((key) => zips[key]))
      expect(report.errors).toEqual([]) // innerhalb des Batches gibt es keine Kollision
      const result = controller.addPack(pack)
      expect(result).toMatchObject({ ok: true, accepted: ['good.zip'] })
      expect(result.rejected).toEqual([{ fileName: 'collision.zip', names: [CLASH] }])
      expect(await played(controller, GOOD)).toEqual([7])
      expect(await played(controller, CLASH)).toEqual([1]) // KEINE stille Ueberschreibung
    })
  }

  it('nur kollidierende ZIPs: ok:false, Zustand und Pack-Revision bleiben unveraendert', async () => {
    const controller = await controllerWithBase()
    const revision = controller.packRevision.value
    const { pack } = await loadAudioPacks([await makeZip({ [CLASH]: new Uint8Array([99]) }, 'collision.zip')])
    expect(controller.addPack(pack)).toMatchObject({ ok: false, accepted: [], rejected: [{ fileName: 'collision.zip' }] })
    expect(controller.packRevision.value).toBe(revision)
    expect(await played(controller, CLASH)).toEqual([1])
  })

  it('zwei neue unabhaengige gueltige ZIPs werden beide ergaenzt', async () => {
    const controller = await controllerWithBase()
    const { pack } = await loadAudioPacks([await makeZip({ [GOOD]: new Uint8Array([7]) }, 'good.zip'), await makeZip({ [OTHER]: new Uint8Array([8]) }, 'other.zip')])
    expect(controller.addPack(pack)).toMatchObject({ ok: true, accepted: ['good.zip', 'other.zip'], rejected: [] })
    expect(await played(controller, GOOD)).toEqual([7])
    expect(await played(controller, OTHER)).toEqual([8])
    expect(await played(controller, CLASH)).toEqual([1])
  })

  it('erneuter Import eines bereits geladenen ZIP-Namens ersetzt sein altes Gegenstueck', async () => {
    const controller = await controllerWithBase()
    const { pack } = await loadAudioPacks([await makeZip({ [CLASH]: new Uint8Array([5]), [GOOD]: new Uint8Array([6]) }, 'base.zip')])
    expect(controller.addPack(pack)).toMatchObject({ ok: true, accepted: ['base.zip'], rejected: [] })
    expect(await played(controller, CLASH)).toEqual([5])
    expect(await played(controller, GOOD)).toEqual([6])
  })

  it('erneuter Import desselben Namens, der aber mit einem ANDEREN geladenen ZIP kollidiert, wird abgelehnt - das alte Gegenstueck bleibt', async () => {
    const controller = await controllerWithBase()
    const second = await loadAudioPacks([await makeZip({ [GOOD]: new Uint8Array([7]) }, 'good.zip')])
    controller.addPack(second.pack)
    const { pack } = await loadAudioPacks([await makeZip({ [CLASH]: new Uint8Array([42]) }, 'good.zip')]) // good.zip enthielte jetzt CLASH aus base.zip
    expect(controller.addPack(pack)).toMatchObject({ ok: false, rejected: [{ fileName: 'good.zip', names: [CLASH] }] })
    expect(await played(controller, GOOD)).toEqual([7])
    expect(await played(controller, CLASH)).toEqual([1])
  })

  it('defektes ZIP + gueltiges ZIP: das gueltige wird ergaenzt, das defekte nur gemeldet', async () => {
    const controller = await controllerWithBase()
    const broken = new File([new Uint8Array(64).fill(7)], 'kaputt.zip', { type: 'application/zip' })
    const { pack, report } = await loadAudioPacks([broken, await makeZip({ [GOOD]: new Uint8Array([7]) }, 'good.zip')])
    expect(report.errors.map((entry) => entry.fileName)).toEqual(['kaputt.zip'])
    expect(controller.addPack(pack)).toMatchObject({ ok: true, accepted: ['good.zip'] })
    expect(await played(controller, GOOD)).toEqual([7])
    expect(await played(controller, CLASH)).toEqual([1])
  })

  it('bestehendes W2-ZIP + gueltiges Coach-ZIP: beide Audios bleiben erreichbar', async () => {
    const controller = createAudioController({ createAudio: () => audioElement })
    controller.setPack((await loadAudioPacks([await makeZip({ 'telephoning__tel-1__q__aaaaaaaa.mp3': new Uint8Array([1]) }, 'business-english-audio-v1.zip')])).pack)
    const coach = await loadAudioPacks([await makeZip({ 'w3-lerncoach__cond1-ex-1__q__bbbbbbbb.mp3': new Uint8Array([2]) }, 'business-english-audio-coach-v1.zip')])
    expect(controller.addPack(coach.pack)).toMatchObject({ ok: true, accepted: ['business-english-audio-coach-v1.zip'] })
    expect(await played(controller, 'telephoning__tel-1__q__aaaaaaaa.mp3')).toEqual([1])
    expect(await played(controller, 'w3-lerncoach__cond1-ex-1__q__bbbbbbbb.mp3')).toEqual([2])
  })
})

describe('Audio-Merge pro ZIP: Importbericht in der App unterscheidet Erfolge und Fehler', () => {
  const library = {
    areaId: 'telephoning', areaTitle: 'Business Telephoning',
    lessons: [{ lessonId: 'l1', lessonTitle: 'L1', scenarios: [{ scenarioId: 's1', scenarioTitle: 'S1', items: [choiceItem] }] }],
  }
  const registry = { libraryByAreaId: { telephoning: { library } }, conflictsByAreaId: {}, report: { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] } }

  async function appWithBase() {
    const wrapper = shallowMount(App, { global: { stubs: { ChoiceCard: false, AudioButton: false } } })
    const importer = wrapper.findComponent({ name: 'PrivateContentImporter' })
    await importer.vm.$emit('libraries-loaded', registry)
    const { files, names } = await packFor([choiceItem])
    const base = createFakePack(files, { fileName: 'base.zip' })
    const baseNames = base.names()
    await importer.vm.$emit('audio-pack-loaded', { pack: base, report: { loaded: [{ fileName: 'base.zip', fileCount: base.fileCount }], errors: [] } })
    return { wrapper, importer, baseNames, names }
  }

  for (const order of [['collision', 'good'], ['good', 'collision']]) {
    it(`Bericht (${order.join(' + ')}): good.zip als geladen, collision.zip als Fehler, base.zip bleibt gelistet, Frage-Audio laeuft weiter`, async () => {
      const { wrapper, importer, baseNames } = await appWithBase()
      const zips = {
        collision: await makeZip({ [baseNames[0]]: new Uint8Array([99]) }, 'collision.zip'),
        good: await makeZip({ [GOOD]: new Uint8Array([7]) }, 'good.zip'),
      }
      await importer.vm.$emit('audio-pack-loaded', await loadAudioPacks(order.map((key) => zips[key])))
      await flushPromises()
      const text = wrapper.text()
      expect(text).toContain('Audio-Pack geladen: good.zip (1 Audio-Dateien)')
      expect(text).toContain('Audio-Pack geladen: base.zip')
      expect(text).not.toContain('Audio-Pack geladen: collision.zip')
      expect(text).toContain('Audio-Pack collision.zip: Audio-Pack ungültig: Audio-Dateinamen kommen auch in einem bereits geladenen Pack vor. Dieses ZIP wird nicht verwendet.')
      expect(text).not.toContain('Audio-Pack good.zip:') // kein Fehlereintrag fuer das gueltige ZIP

      const navigator = () => wrapper.findAllComponents({ name: 'LearningNavigator' })[0] // je Ansicht eine neue Instanz
      await navigator().vm.$emit('open-area', 'telephoning')
      await navigator().vm.$emit('open-lesson', 'l1')
      await navigator().vm.$emit('start-scenario', 's1')
      await vi.waitFor(() => expect(audioElement.realPlays).toHaveLength(1))
      expect(await bytesOf(blobForSource(audioElement.realPlays[0]))).toEqual([1, 2, 3, 4]) // Original aus base.zip
    })
  }

  it('reiner Kollisions-Import: nur Fehlermeldung, "bleibt aktiv"-Hinweis, kein falscher Erfolgseintrag', async () => {
    const { wrapper, importer, baseNames } = await appWithBase()
    await importer.vm.$emit('audio-pack-loaded', await loadAudioPacks([await makeZip({ [baseNames[0]]: new Uint8Array([99]) }, 'collision.zip')]))
    await flushPromises()
    expect(wrapper.text()).toContain('Audio-Pack collision.zip: Audio-Pack ungültig: Audio-Dateinamen kommen auch in einem bereits geladenen Pack vor. Der bisher geladene Audio-Pack bleibt aktiv.')
    expect(wrapper.text()).not.toContain('Audio-Pack geladen: collision.zip')
    expect(wrapper.text()).toContain('Audio-Pack geladen: base.zip')
  })
})
