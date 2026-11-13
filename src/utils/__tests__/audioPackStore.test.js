// @vitest-environment node
// Auftrag 103: Audio-ZIPs lokal speichern und beim Start wiederherstellen. Nur kuenstliche Demo-ZIPs.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { createAudioController } from '../audioController.js'
import { loadAudioPacks } from '../audioPack.js'
import { createAudioPackStorage, createAudioPackStore } from '../audioPackStore.js'
import { PrivateStoreError, STORE_ERROR, createPrivateLibraryStore } from '../privateLibraryStore.js'

async function makeZip(entries, name) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 })
  for (const [entryName, data] of Object.entries(entries)) await writer.add(entryName, new Uint8ArrayReader(data))
  return new File([await writer.close()], name, { type: 'application/zip' })
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

// Wie App.vue: ZIP einzeln laden und ueber addPack aktivieren; liefert true, wenn es aktiv wurde.
const newController = () => {
  const audio = createAudioController({ createAudio: () => ({ addEventListener() {}, pause() {}, play: () => Promise.resolve() }) })
  const active = new Map() // Audio-Dateiname -> Pack-Teil, der ihn liefert
  const activate = async (file) => {
    const { pack } = await loadAudioPacks([file])
    if (!pack || !audio.addPack(pack).accepted.includes(file.name)) return false
    for (const name of pack.names()) active.set(name, pack)
    return true
  }
  return { audio, activate, active }
}
const activateInto = (controller) => controller.activate
const hasName = (controller, name) => controller.active.has(name)

describe('Audio-Pack-Speicher', () => {
  it('drei Packs werden gespeichert und nach einem Neustart ohne erneuten Import alle wiederhergestellt', async () => {
    const zips = [
      await makeZip({ 'quiz__a.mp3': new Uint8Array([1]) }, 'business-english-audio-v1.zip'),
      await makeZip({ 'coach__b.mp3': new Uint8Array([2]) }, 'business-english-audio-coach-v1.zip'),
      await makeZip({ 'w3__c.mp3': new Uint8Array([3]) }, 'business-english-audio-w3-unterricht.zip'),
    ]
    const first = createAudioPackStorage()
    await first.save(zips)
    expect(first.state.stored.map((entry) => entry.fileName)).toHaveLength(3)
    expect(first.state.problem).toBe('')

    // "Neustart": neue App-Instanz, nur der IndexedDB-Bestand bleibt.
    const controller = newController()
    const second = createAudioPackStorage()
    await second.restore(activateInto(controller))
    expect(second.state.status).toBe('ready')
    expect(second.state.restored).toHaveLength(3)
    for (const name of ['quiz__a.mp3', 'coach__b.mp3', 'w3__c.mp3']) expect(hasName(controller, name)).toBe(true)
    expect(controller.audio.hasPack.value).toBe(true)
    const blob = await controller.active.get('w3__c.mp3').getBlob('w3__c.mp3')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([3])
  })

  it('ein erneut importiertes ZIP ersetzt nur seinen eigenen Eintrag, andere Packs bleiben', async () => {
    const storage = createAudioPackStorage()
    await storage.save([await makeZip({ 'a.mp3': new Uint8Array([1]) }, 'one.zip'), await makeZip({ 'b.mp3': new Uint8Array([2]) }, 'two.zip')])
    await storage.save([await makeZip({ 'a.mp3': new Uint8Array([1]), 'a2.mp3': new Uint8Array([9]) }, 'one.zip')])
    const records = await createAudioPackStore().list()
    expect(records.map((record) => record.fileName).sort()).toEqual(['one.zip', 'two.zip'])
  })

  it('ein ungueltiges ZIP wird nicht aktiviert und ueberschreibt nichts; gespeicherte gueltige bleiben', async () => {
    const storage = createAudioPackStorage()
    await storage.save([await makeZip({ 'a.mp3': new Uint8Array([1]) }, 'good.zip')])
    const bad = new File([new Uint8Array([1, 2, 3, 4])], 'good.zip', { type: 'application/zip' })
    const { pack, report } = await loadAudioPacks([bad])
    expect(pack).toBeNull()
    expect(report.errors).toHaveLength(1) // App speichert nur, was aktiviert wurde: hier nichts
    const controller = newController()
    await createAudioPackStorage().restore(activateInto(controller))
    expect(hasName(controller, 'a.mp3')).toBe(true)
  })

  it('beschaedigtes gespeichertes ZIP wird gemeldet, aber nicht geloescht; andere Packs werden trotzdem wiederhergestellt', async () => {
    await createAudioPackStorage().save([await makeZip({ 'a.mp3': new Uint8Array([1]) }, 'good.zip')])
    await createAudioPackStore().put(new File([new Uint8Array([9, 9, 9])], 'broken.zip', { type: 'application/zip' }))
    const controller = newController()
    const storage = createAudioPackStorage()
    await storage.restore(activateInto(controller))
    expect(storage.state.restored).toEqual(['good.zip'])
    expect(storage.state.problem).toContain('broken.zip')
    expect((await createAudioPackStore().list()).map((record) => record.fileName).sort()).toEqual(['broken.zip', 'good.zip'])
  })

  it('Speicher voll: verstaendliche Meldung, andere Packs und JSON-Datenbank bleiben unberuehrt', async () => {
    const json = createPrivateLibraryStore()
    const storage = createAudioPackStorage({
      store: {
        isSupported: () => true,
        list: async () => [],
        put: async () => { throw new PrivateStoreError(STORE_ERROR.QUOTA) },
      },
    })
    await storage.save([await makeZip({ 'a.mp3': new Uint8Array([1]) }, 'big.zip')])
    expect(storage.state.problem).toContain('nicht genug Speicherplatz')
    expect(storage.state.problem).toContain('in dieser Sitzung trotzdem')
    expect(await json.list()).toEqual({ records: [], corrupt: [] }) // JSON-Speicher unberuehrt und funktionsfaehig
  })

  it('ohne IndexedDB: Status unavailable, kein Absturz', async () => {
    const storage = createAudioPackStorage({ store: createAudioPackStore({ indexedDB: null }) })
    globalThis.indexedDB = undefined
    await storage.restore(async () => true)
    expect(storage.state.status).toBe('unavailable')
  })
})
