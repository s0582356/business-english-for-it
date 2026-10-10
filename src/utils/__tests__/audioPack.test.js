import { mount, flushPromises } from '@vue/test-utils'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter, configure } from '@zip.js/zip.js'
import { describe, expect, it } from 'vitest'
import PrivateContentImporter from '../../components/PrivateContentImporter.vue'
import { AudioPackError, combineAudioPacks, isAudioPackFile, loadAudioPacks, openAudioPack, splitImportFiles } from '../audioPack.js'

configure({ useWebWorkers: false })

async function makeZip(entries, name = 'business-english-audio-v1.zip') {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 })
  for (const [entryName, bytes] of Object.entries(entries)) await writer.add(entryName, new Uint8ArrayReader(bytes))
  return new File([await writer.close()], name, { type: 'application/zip' })
}

function library(areaId, itemId = `${areaId}-01`) {
  return {
    type: 'businessEnglishLibrary', schemaVersion: 1, libraryId: `lib-${areaId}`, libraryVersion: 1, areaId, areaTitle: areaId,
    lessons: [{ lessonId: 'l1', lessonTitle: 'L', scenarios: [{ scenarioId: 's1', scenarioTitle: 'S', items: [
      { itemId, type: 'choice', prompt: 'P', options: ['A', 'B'], correctAnswer: 'A', explanation: 'E' },
    ] }] }],
  }
}

function jsonFile(areaId) {
  return new File([JSON.stringify(library(areaId))], `${areaId}-sample.json`, { type: 'application/json' })
}

async function selectFiles(wrapper, files) {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await flushPromises()
}

describe('Audio-Pack Reader (zip.js, nur Inhaltsverzeichnis beim Laden)', () => {
  it('erkennt .zip und trennt Dateien nach Typ', () => {
    expect(isAudioPackFile({ name: 'business-english-audio-v1.zip', type: '' })).toBe(true)
    expect(isAudioPackFile({ name: 'x.ZIP', type: '' })).toBe(true)
    expect(isAudioPackFile({ name: 'x', type: 'application/x-zip-compressed' })).toBe(true)
    expect(isAudioPackFile({ name: 'telephoning-sample.json', type: 'application/json' })).toBe(false)
    const { libraryFiles, audioFiles } = splitImportFiles([{ name: 'a.json' }, { name: 'b.zip' }, { name: 'c.json' }])
    expect(libraryFiles.map((file) => file.name)).toEqual(['a.json', 'c.json'])
    expect(audioFiles.map((file) => file.name)).toEqual(['b.zip'])
  })

  it('liest Eintraege lazy: has() sofort, getBlob() liefert exakt die Bytes', async () => {
    const zip = await makeZip({ 'a__x__q__11111111.mp3': new Uint8Array([1, 2, 3]), 'a__x__s__22222222.mp3': new Uint8Array([9, 9]) })
    const pack = await openAudioPack(zip)
    expect(pack.fileCount).toBe(2)
    expect(pack.has('a__x__q__11111111.mp3')).toBe(true)
    expect(pack.has('missing.mp3')).toBe(false)
    const blob = await pack.getBlob('a__x__q__11111111.mp3')
    expect(blob.type).toBe('audio/mpeg')
    expect(blob.size).toBe(3)
    expect(await pack.getBlob('missing.mp3')).toBeNull()
  })

  it('ignoriert Ordner, macOS-Metadaten, Dotfiles und Nicht-MP3 und nutzt Basisnamen', async () => {
    const zip = await makeZip({
      'audio/a__x__q__11111111.mp3': new Uint8Array([1]),
      '__MACOSX/audio/._a__x__q__11111111.mp3': new Uint8Array([2]),
      '.DS_Store': new Uint8Array([3]),
      'readme.txt': new Uint8Array([4]),
    })
    const pack = await openAudioPack(zip)
    expect(pack.fileCount).toBe(1)
    expect(pack.has('a__x__q__11111111.mp3')).toBe(true)
  })

  it('defektes ZIP wirft in openAudioPack, aber loadAudioPacks wirft nie', async () => {
    const broken = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'kaputt.zip', { type: 'application/zip' })
    await expect(openAudioPack(broken)).rejects.toBeTruthy()
    const good = await makeZip({ 'a__x__q__11111111.mp3': new Uint8Array([1]) })
    const result = await loadAudioPacks([broken, good])
    expect(result.report.errors.map((entry) => entry.fileName)).toEqual(['kaputt.zip'])
    expect(result.report.loaded).toEqual([{ fileName: 'business-english-audio-v1.zip', fileCount: 1 }])
    expect(result.pack.has('a__x__q__11111111.mp3')).toBe(true)
    expect((await loadAudioPacks([broken])).pack).toBeNull()
  })
})

describe('PrivateContentImporter - ein Dateidialog fuer JSON + ZIP', () => {
  const areas = ['telephoning', 'email-writing', 'vocabulary', 'socialising-opinions']

  it('Test 1: 4 JSONs ohne ZIP verhalten sich wie bisher (kein Audio-Event)', async () => {
    const wrapper = mount(PrivateContentImporter)
    await selectFiles(wrapper, areas.map(jsonFile))
    const loaded = wrapper.emitted('libraries-loaded')
    expect(loaded).toHaveLength(1)
    expect(Object.keys(loaded[0][0].libraryByAreaId).sort()).toEqual([...areas].sort())
    expect(loaded[0][0].report.errors).toEqual([])
    expect(wrapper.emitted('audio-pack-loaded')).toBeUndefined()
  })

  it('Test 2: 4 JSONs + ZIP in EINEM Dialog laden Libraries und Audio-Pack', async () => {
    const wrapper = mount(PrivateContentImporter)
    const zip = await makeZip({ 'telephoning__telephoning-01__q__11111111.mp3': new Uint8Array([1, 2]) })
    await selectFiles(wrapper, [...areas.map(jsonFile), zip])
    expect(Object.keys(wrapper.emitted('libraries-loaded')[0][0].libraryByAreaId)).toHaveLength(4)
    expect(wrapper.emitted('libraries-loaded')[0][0].report.errors).toEqual([])
    const audio = wrapper.emitted('audio-pack-loaded')[0][0]
    expect(audio.pack.fileCount).toBe(1)
    expect(audio.report.loaded).toHaveLength(1)
  })

  it('Test 3: defektes ZIP -> Audio-Fehler, Libraries weiterhin geladen', async () => {
    const wrapper = mount(PrivateContentImporter)
    const broken = new File([new Uint8Array(64).fill(7)], 'business-english-audio-v1.zip', { type: 'application/zip' })
    await selectFiles(wrapper, [...areas.map(jsonFile), broken])
    expect(Object.keys(wrapper.emitted('libraries-loaded')[0][0].libraryByAreaId)).toHaveLength(4)
    expect(wrapper.emitted('libraries-loaded')[0][0].report.errors).toEqual([])
    const audio = wrapper.emitted('audio-pack-loaded')[0][0]
    expect(audio.pack).toBeNull()
    expect(audio.report.errors).toHaveLength(1)
  })

  it('Test 4: ZIP ohne passendes Audio laedt sauber (Mapping bleibt stumm)', async () => {
    const wrapper = mount(PrivateContentImporter)
    const zip = await makeZip({ 'irgendwas__anderes__q__00000000.mp3': new Uint8Array([1]) })
    await selectFiles(wrapper, [jsonFile('telephoning'), zip])
    const audio = wrapper.emitted('audio-pack-loaded')[0][0]
    expect(audio.pack.has('telephoning__telephoning-01__q__11111111.mp3')).toBe(false)
  })

  it('akzeptiert .json und .zip im Dateidialog', () => {
    const wrapper = mount(PrivateContentImporter)
    const accept = wrapper.get('input[type="file"]').attributes('accept')
    expect(accept).toContain('.json')
    expect(accept).toContain('.zip')
    expect(wrapper.get('input[type="file"]').attributes('multiple')).toBeDefined()
  })

  it('nur ZIP gewaehlt: bestehende Libraries werden nicht angefasst (kein libraries-loaded)', async () => {
    const wrapper = mount(PrivateContentImporter)
    await selectFiles(wrapper, [await makeZip({ 'a__x__q__11111111.mp3': new Uint8Array([1]) })])
    expect(wrapper.emitted('libraries-loaded')).toBeUndefined()
    expect(wrapper.emitted('audio-pack-loaded')).toHaveLength(1)
  })
})

describe('Audio-Pack: doppelte Dateinamen werden nie still akzeptiert', () => {
  const NAME = 'a__x__q__11111111.mp3'

  it('Duplicate im selben ZIP (gleicher Basisname in zwei Ordnern): Pack wird abgelehnt, kein first/last wins', async () => {
    const zip = await makeZip({ [`one/${NAME}`]: new Uint8Array([1]), [`two/${NAME}`]: new Uint8Array([2]), 'a__x__s__22222222.mp3': new Uint8Array([3]) }, 'dup.zip')
    const error = await openAudioPack(zip).catch((caught) => caught)
    expect(error).toBeInstanceOf(AudioPackError)
    expect(error.code).toBe('duplicate-entries')
    expect(error.details).toEqual([NAME])
    expect(error.message).toContain('doppelte Audio-Dateinamen')

    const result = await loadAudioPacks([zip])
    expect(result.pack).toBeNull() // weder die erste noch die letzte Datei wird verwendet
    expect(result.report.loaded).toEqual([])
    expect(result.report.errors).toHaveLength(1)
    expect(result.report.errors[0]).toMatchObject({ fileName: 'dup.zip', code: 'duplicate-entries' })
    expect(result.report.errors[0].reason).toContain('doppelte Audio-Dateinamen')
  })

  it('macOS-Metadaten (__MACOSX/._name.mp3) zaehlen nicht als Duplikat', async () => {
    const zip = await makeZip({ [NAME]: new Uint8Array([1]), [`__MACOSX/._${NAME}`]: new Uint8Array([9]) })
    const pack = await openAudioPack(zip)
    expect(pack.fileCount).toBe(1)
  })

  it('normales, eindeutiges ZIP bleibt gueltig', async () => {
    const zip = await makeZip({ [NAME]: new Uint8Array([1, 2]), 'a__x__s__22222222.mp3': new Uint8Array([3]) })
    const result = await loadAudioPacks([zip])
    expect(result.report.errors).toEqual([])
    expect(result.pack.fileCount).toBe(2)
    expect(result.pack.names().sort()).toEqual([NAME, 'a__x__s__22222222.mp3'])
  })

  it('mehrere Packs ohne Ueberschneidung werden kombiniert', async () => {
    const a = await makeZip({ [NAME]: new Uint8Array([1]) }, 'a.zip')
    const b = await makeZip({ 'b__y__q__33333333.mp3': new Uint8Array([2]) }, 'b.zip')
    const result = await loadAudioPacks([a, b])
    expect(result.report.errors).toEqual([])
    expect(result.pack.fileCount).toBe(2)
    expect(result.pack.has(NAME)).toBe(true)
    expect(result.pack.has('b__y__q__33333333.mp3')).toBe(true)
  })

  it('Duplicate ueber mehrere Packs: ALLE beteiligten Packs werden abgelehnt, unabhaengig von der Reihenfolge; unbeteiligte bleiben', async () => {
    const make = async () => [
      await makeZip({ [NAME]: new Uint8Array([1]) }, 'a.zip'),
      await makeZip({ [NAME]: new Uint8Array([2]), 'c__z__q__44444444.mp3': new Uint8Array([4]) }, 'b.zip'),
      await makeZip({ 'd__w__q__55555555.mp3': new Uint8Array([5]) }, 'c.zip'),
    ]
    const [a, b, c] = await make()
    for (const order of [[a, b, c], [b, a, c], [c, b, a]]) {
      const result = await loadAudioPacks(order)
      expect(result.report.errors.map((entry) => entry.fileName).sort()).toEqual(['a.zip', 'b.zip'])
      expect(result.report.errors.every((entry) => entry.code === 'duplicate-across-packs')).toBe(true)
      expect(result.report.loaded).toEqual([{ fileName: 'c.zip', fileCount: 1 }])
      expect(result.pack.has(NAME)).toBe(false) // weder a noch b liefert still ein Audio
      expect(result.pack.has('c__z__q__44444444.mp3')).toBe(false)
      expect(result.pack.has('d__w__q__55555555.mp3')).toBe(true)
    }
  })

  it('zwei Packs mit nur gemeinsamen Dateien: kein Pack, beide gemeldet', async () => {
    const result = await loadAudioPacks([await makeZip({ [NAME]: new Uint8Array([1]) }, 'a.zip'), await makeZip({ [NAME]: new Uint8Array([1]) }, 'b.zip')])
    expect(result.pack).toBeNull()
    expect(result.report.errors).toHaveLength(2)
  })

  it('combineAudioPacks selbst loest Konflikte nicht still auf, sondern wirft', async () => {
    const a = await openAudioPack(await makeZip({ [NAME]: new Uint8Array([1]) }, 'a.zip'))
    const b = await openAudioPack(await makeZip({ [NAME]: new Uint8Array([2]) }, 'b.zip'))
    expect(() => combineAudioPacks([a, b])).toThrow(AudioPackError)
    expect(() => combineAudioPacks([a])).not.toThrow()
  })

  it('Importer: Duplicate-ZIP beeintraechtigt den Library-Import nicht', async () => {
    const wrapper = mount(PrivateContentImporter)
    const dup = await makeZip({ [`one/${NAME}`]: new Uint8Array([1]), [`two/${NAME}`]: new Uint8Array([2]) }, 'dup.zip')
    await selectFiles(wrapper, [jsonFile('telephoning'), dup])
    expect(Object.keys(wrapper.emitted('libraries-loaded')[0][0].libraryByAreaId)).toEqual(['telephoning'])
    expect(wrapper.emitted('libraries-loaded')[0][0].report.errors).toEqual([])
    const audio = wrapper.emitted('audio-pack-loaded')[0][0]
    expect(audio.pack).toBeNull()
    expect(audio.report.errors[0].code).toBe('duplicate-entries')
  })
})
