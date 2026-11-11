// Auftrag 095: (1) vollstaendiger Wertvergleich beim Loeschen, (2) neueste gestartete Pruefung hat Vorrang,
// (3) disposed-Schutz. Alle Inhalte sind kuenstliche Demo-Daten.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FDBObjectStore from 'fake-indexeddb/lib/FDBObjectStore'
import { createPrivateLibraryController } from '../privateLibraryController.js'
import { createLibraryPersistence } from '../privateLibraryPersistence.js'
import { REMOVE_OUTCOME, STORED_SCHEMA_VERSION, createPrivateLibraryStore } from '../privateLibraryStore.js'
import { createSyncChannel } from '../privateLibrarySync.js'
import { fileOf, freshEnvironment, quizData } from './privateStorageTestHelpers.js'
import { makeTab, storedSnapshot } from './privateTabHelpers.js'

const bytesOf = (...numbers) => new Uint8Array(numbers).buffer

function record(overrides = {}) {
  const bytes = overrides.bytes ?? bytesOf(1, 2, 3, 4)
  return {
    key: 'quiz:test-area', kind: 'quiz', areaId: 'test-area', areaTitle: 'Titel', libraryId: 'quiz-test', libraryVersion: 1,
    fileName: 'demo.json', fingerprint: 'f'.repeat(64), size: bytes.byteLength, savedAt: 1000, schemaVersion: STORED_SCHEMA_VERSION, ...overrides, bytes,
  }
}

// Rohschreiben ohne jede Pruefung: erlaubt beliebige Legacy-/Defektformen (Uint8Array-Bytes, Zusatzfelder, Map ...).
async function rawPut(value) {
  const db = await new Promise((done, fail) => {
    const request = indexedDB.open('businessEnglishPrivateLibraries', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('libraries', { keyPath: 'key' })
    request.onsuccess = () => done(request.result)
    request.onerror = () => fail(request.error)
  })
  await new Promise((done, fail) => {
    const tx = db.transaction('libraries', 'readwrite')
    tx.objectStore('libraries').put(value)
    tx.oncomplete = done
    tx.onerror = () => fail(tx.error)
  })
  db.close()
}

const stores = []
const newStore = () => {
  const store = createPrivateLibraryStore()
  stores.push(store)
  return store
}
const tabs = []
const tab = (options) => {
  const created = makeTab(options)
  tabs.push(created)
  return created
}
const stillThere = async (key = 'quiz:test-area') => {
  const { records, corrupt } = await storedSnapshot()
  return records.some((entry) => entry.key === key) || corrupt.some((entry) => entry.key === key)
}

beforeEach(freshEnvironment)
afterEach(() => {
  vi.restoreAllMocks()
  while (stores.length) stores.pop().close()
  while (tabs.length) tabs.pop().close()
})

describe('MAJOR 1: jede Aenderung am gespeicherten Wert verhindert die alte Loeschbestaetigung', () => {
  // Legacy-/Defektdatensatz mit Uint8Array statt ArrayBuffer (nicht als gueltig erkannt, aber vergleichbar).
  const legacy = (overrides = {}) => ({ key: 'coach', kind: 'coach', areaTitle: 'Alt', extra: { nested: [1, { deep: 'a' }] }, savedAt: 5, bytes: new Uint8Array([1, 2, 3, 4]), ...overrides })

  it.each([
    ['areaTitle geaendert (alle anderen Felder gleich)', record(), record({ areaTitle: 'Neuer Titel' })],
    ['Zusatzfeld hinzugefuegt', record(), { ...record(), zusatz: 'x' }],
    ['Zusatzfeld geaendert', { ...record(), zusatz: 'x' }, { ...record(), zusatz: 'y' }],
    ['Feld entfernt', { ...record(), zusatz: 'x' }, record()],
    ['Feld entfernt (areaTitle)', record(), (() => { const { areaTitle, ...rest } = record(); return areaTitle && rest })()],
    ['verschachtelter Wert geaendert', { ...record(), meta: { a: { b: [1, 2, 3] } } }, { ...record(), meta: { a: { b: [1, 2, 4] } } }],
    ['gleiche Byte-Laenge, anderer Inhalt', record(), record({ bytes: bytesOf(9, 8, 7, 6) })],
    ['gleicher Inhalt, andere Laenge', record(), record({ bytes: bytesOf(1, 2, 3, 4, 5), size: 4 })],
    ['Typ des Feldes geaendert (Zahl -> Text)', record(), { ...record(), libraryVersion: '1' }],
  ])('%s -> changed, Datensatz bleibt', async (_label, before, after) => {
    const store = newStore()
    await rawPut(before)
    const confirmed = await store.readSnapshot('quiz:test-area')
    await rawPut(after)
    expect((await store.removeIfUnchanged('quiz:test-area', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect(await stillThere()).toBe(true)
  })

  it('Legacy: Uint8Array [1,2,3,4] durch [9,8,7,6] ersetzt -> changed', async () => {
    const store = newStore()
    await rawPut(legacy())
    const confirmed = await store.readSnapshot('coach')
    await rawPut(legacy({ bytes: new Uint8Array([9, 8, 7, 6]) }))
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect(await stillThere('coach')).toBe(true)
  })

  it('Legacy: ArrayBuffer gegen Uint8Array mit denselben Bytes getauscht -> changed (beide Richtungen)', async () => {
    const store = newStore()
    await rawPut(legacy())
    const asView = await store.readSnapshot('coach')
    await rawPut(legacy({ bytes: new Uint8Array([1, 2, 3, 4]).buffer }))
    expect((await store.removeIfUnchanged('coach', asView)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    const asBuffer = await store.readSnapshot('coach')
    await rawPut(legacy())
    expect((await store.removeIfUnchanged('coach', asBuffer)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
  })

  it('Legacy: verschachteltes Feld geaendert -> changed', async () => {
    const store = newStore()
    await rawPut(legacy())
    const confirmed = await store.readSnapshot('coach')
    await rawPut(legacy({ extra: { nested: [1, { deep: 'b' }] } }))
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
  })

  it('vollstaendig identischer beschaedigter Legacy-Wert (auch neu geschrieben) -> Entfernen zulaessig', async () => {
    const store = newStore()
    await rawPut(legacy())
    const confirmed = await store.readSnapshot('coach')
    await rawPut(legacy()) // gleicher Inhalt, neu geschrieben
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.REMOVED)
    expect(await stillThere('coach')).toBe(false)
  })

  it('Snapshot ist unabhaengig vom Speicher und enthaelt den KOMPLETTEN Wert', async () => {
    const store = newStore()
    await rawPut(legacy())
    const confirmed = await store.readSnapshot('coach')
    expect(confirmed.value).toMatchObject({ key: 'coach', areaTitle: 'Alt', extra: { nested: [1, { deep: 'a' }] } })
    expect(Object.prototype.toString.call(confirmed.value.bytes)).toBe('[object Uint8Array]')
    await rawPut(legacy({ areaTitle: 'Neu' }))
    expect(confirmed.value.areaTitle).toBe('Alt')
  })

  it('nicht unterstuetzter Werttyp im Speicher: Snapshot scheitert, nichts wird veraendert', async () => {
    const store = newStore()
    await rawPut({ key: 'coach', savedAt: 5, bytes: new Uint8Array([1]), lookup: new Map([[1, 2]]) })
    await expect(store.readSnapshot('coach')).rejects.toMatchObject({ name: 'PrivateStoreError' })
    expect(await stillThere('coach')).toBe(true)
  })

  it('Wert wird nach der Bestaetigung unvergleichbar (Map als neues Feld): niemals entfernt, Datensatz bleibt', async () => {
    const store = newStore()
    await rawPut(legacy())
    const confirmed = await store.readSnapshot('coach')
    await rawPut({ ...legacy(), lookup: new Map([[1, 2]]) })
    const result = await store.removeIfUnchanged('coach', confirmed).catch((error) => error)
    expect(result.outcome).not.toBe(REMOVE_OUTCOME.REMOVED)
    expect(await stillThere('coach')).toBe(true)
  })

  it('unvergleichbarer Wert im SELBEN Feld wie im Snapshot (Map gegen Map): Vergleich wirft, Datensatz bleibt, keine Erfolgsmeldung', async () => {
    const store = newStore()
    await rawPut(legacy())
    const confirmed = await store.readSnapshot('coach')
    // Snapshot manipuliert (wie ein Wert, der zwischenzeitlich einen nicht vergleichbaren Typ bekam): Feld extra ist ein Set
    await rawPut({ ...legacy(), extra: new Set([1]) })
    const mapped = { ...confirmed, value: { ...confirmed.value, extra: new Set([2]) } }
    await expect(store.removeIfUnchanged('coach', mapped)).rejects.toMatchObject({ name: 'PrivateStoreError' })
    expect(await stillThere('coach')).toBe(true)
  })

  it('Snapshot ohne vollstaendigen Wert loescht nie', async () => {
    const store = newStore()
    await rawPut(record())
    const { identity } = await store.readSnapshot('quiz:test-area')
    expect((await store.removeIfUnchanged('quiz:test-area', { identity })).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect((await store.removeIfUnchanged('quiz:test-area', { identity, value: null })).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect(await stillThere()).toBe(true)
  })

  it('parallel: Aktualisierung (anderer areaTitle, hoehere Version) und Loeschung ueber zwei Verbindungen -> neuerer Stand ueberlebt', async () => {
    for (const order of ['delete-first', 'update-first']) {
      const one = newStore()
      const two = newStore()
      await one.forcePut(record())
      const confirmed = await one.readSnapshot('quiz:test-area')
      const update = () => two.putIfNewer(record({ libraryVersion: 2, areaTitle: 'Neuer Titel', fingerprint: 'e'.repeat(64) }))
      const removal = () => one.removeIfUnchanged('quiz:test-area', confirmed)
      await Promise.all(order === 'delete-first' ? [removal(), update()] : [update(), removal()])
      expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@2'])
      const cleanup = await one.readSnapshot('quiz:test-area')
      await one.removeIfUnchanged('quiz:test-area', cleanup)
    }
  })

  it('Controller: gleiche Metadaten, aber geaenderter areaTitle nach der Rueckfrage -> NICHT entfernt, Meldung, Fortschritt unveraendert', async () => {
    window.localStorage.setItem('businessEnglishProgress:v2', '{"demo":1}')
    const a = tab()
    await a.importFiles([fileOf(quizData(), 'v1.json')])
    const { snapshot } = await a.controller.prepareRemoval('quiz:test-area')
    const [stored] = (await storedSnapshot()).records
    await rawPut({ ...stored, areaTitle: 'Heimlich geaendert' }) // gleiche Bytes, gleiche Metadaten (Fingerabdruck, Groesse, savedAt ...)
    expect(await a.controller.remove('quiz:test-area', snapshot)).toBe(false)
    expect(a.controller.state.notice).toContain('NICHT entfernt')
    expect((await storedSnapshot()).records[0].areaTitle).toBe('Heimlich geaendert')
    expect(window.localStorage.getItem('businessEnglishProgress:v2')).toBe('{"demo":1}')
    expect(a.activeVersion()).toBe(1)
  })

  it('Controller: nicht vergleichbarer Wert -> prepareRemoval meldet Fehler und oeffnet keine Rueckfrage', async () => {
    const a = tab()
    await a.restore()
    await rawPut({ key: 'coach', savedAt: 5, bytes: new Uint8Array([1]), lookup: new Map() })
    await a.controller.refreshFromStore()
    const prepared = await a.controller.prepareRemoval('coach')
    expect(prepared).toEqual({ error: true })
    expect(a.controller.state.noticeIsError).toBe(true)
    expect(await stillThere('coach')).toBe(true)
  })

  it('Quellcode: der Vergleich in removeIfUnchanged nutzt strictEqual (kein JSON.stringify, kein Hash, kein await)', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(__dirname, '../privateLibraryStore.js'), 'utf8')
    const compare = source.slice(source.indexOf('export function sameSnapshot'), source.indexOf('// Gleiche Metadaten-Identitaet'))
    expect(compare).toMatch(/strictEqual\(stored, expected\.value\)/)
    expect(compare).not.toMatch(/JSON\.stringify|digest|await/)
    const removal = source.slice(source.indexOf('async function removeIfUnchanged'), source.indexOf('// Unbedingtes Schreiben'))
    expect(removal.slice(removal.indexOf('atomic('))).not.toMatch(/\bawait\b|JSON\.stringify|crypto\.subtle/)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('MAJOR 2: nur die zuletzt gestartete Pruefung darf ihren Abschlusszustand uebernehmen', () => {
  const summary = (version) => ({ key: 'quiz:test-area', kind: 'quiz', areaId: 'test-area', libraryVersion: version, fileName: `v${version}.json`, fingerprint: String(version), size: 1, savedAt: version, identity: { savedAt: version } })
  const ready = (version) => ({ status: 'ready', records: [summary(version)], invalid: [], missing: [] })
  const failed = () => ({ status: 'error', records: [], invalid: [], missing: [] })

  // Controller mit steuerbarer Persistenz: jede inspect()-Anfrage wartet, bis der Test sie beantwortet.
  function harness() {
    const pending = []
    const applied = []
    let clock = 0
    const persistence = {
      isSupported: () => true,
      load: async () => ({ status: 'ready', records: [summary(1)], files: [], invalid: [], missing: [] }),
      inspect: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    }
    const controller = createPrivateLibraryController({
      persistence,
      getRegistries: () => ({ quiz: { libraryByAreaId: {}, conflictsByAreaId: {} }, coach: {}, figures: {}, practice: {} }),
      apply: { quiz: (r) => applied.push(['quiz', r]), coach: (r) => applied.push(['coach', r]), figures: (r) => applied.push(['figures', r]), practice: (r) => applied.push(['practice', r]) },
      sync: null,
      now: () => (clock += 10),
    })
    return { controller, pending, applied }
  }
  const versions = (controller) => controller.state.records.map((entry) => entry.libraryVersion)

  it('neue Pruefung erfolgreich, alte spaeter erfolgreich: der Stand der neuen bleibt', async () => {
    const { controller, pending } = harness()
    await controller.restore()
    const older = controller.refreshFromStore()
    const newer = controller.refreshFromStore()
    pending[1].resolve(ready(3))
    expect(await newer).toBe(true)
    const checkedAt = controller.state.lastCheckedAt
    pending[0].resolve(ready(2))
    expect(await older).toBe(false)
    expect(versions(controller)).toEqual([3])
    expect(controller.state.lastCheckedAt).toBe(checkedAt)
    expect(controller.state.checkFailed).toBe(false)
  })

  it('neue Pruefung FEHLERHAFT, alte spaeter erfolgreich: der Fehler bleibt sichtbar, kein frischer Stand', async () => {
    const { controller, pending } = harness()
    await controller.restore()
    const checkedBefore = controller.state.lastCheckedAt
    const older = controller.refreshFromStore()
    const newer = controller.refreshFromStore()
    pending[1].resolve(failed())
    expect(await newer).toBe(false)
    expect(controller.state.checkFailed).toBe(true)
    pending[0].resolve(ready(2)) // verspaetet erfolgreich
    expect(await older).toBe(false)
    expect(controller.state.checkFailed).toBe(true) // der Fehler wurde NICHT verdeckt
    expect(controller.state.lastCheckedAt).toBe(checkedBefore) // keine neue Pruefzeit
    expect(versions(controller)).toEqual([1]) // zuletzt bekannter Stand, nicht der verspaetete
  })

  it('neue Pruefung erfolgreich, alte spaeter fehlerhaft: der Fehler der alten setzt nichts', async () => {
    const { controller, pending } = harness()
    await controller.restore()
    const older = controller.refreshFromStore()
    const newer = controller.refreshFromStore()
    pending[1].resolve(ready(3))
    await newer
    pending[0].resolve(failed())
    expect(await older).toBe(false)
    expect(controller.state.checkFailed).toBe(false)
    expect(versions(controller)).toEqual([3])
  })

  it('eine Pruefung, die mit einer Ausnahme endet, zaehlt als Fehler der (neuesten) Pruefung', async () => {
    const { controller, pending } = harness()
    await controller.restore()
    const only = controller.refreshFromStore()
    pending[0].reject(new Error('boom'))
    expect(await only).toBe(false)
    expect(controller.state.checkFailed).toBe(true)
  })

  it('mehrere schnell gestartete Pruefungen: nur die letzte uebernimmt, beliebige Antwortreihenfolge', async () => {
    for (const answerOrder of [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 4, 0, 3, 1]]) {
      const { controller, pending } = harness()
      await controller.restore()
      const runs = [1, 2, 3, 4, 5].map(() => controller.refreshFromStore())
      for (const index of answerOrder) pending[index].resolve(ready(index + 10))
      const results = await Promise.all(runs)
      expect(results).toEqual([false, false, false, false, true])
      expect(versions(controller)).toEqual([14])
    }
  })

  it('Fehler und lastCheckedAt bleiben sachlich korrekt: nur ein erfolgreiches letztes Ergebnis setzt eine neue Pruefzeit', async () => {
    const { controller, pending } = harness()
    await controller.restore()
    const t0 = controller.state.lastCheckedAt
    const a = controller.refreshFromStore()
    pending[0].resolve(failed())
    await a
    expect(controller.state.lastCheckedAt).toBe(t0)
    expect(controller.state.checkFailed).toBe(true)
    const b = controller.refreshFromStore()
    pending[1].resolve(ready(2))
    await b
    expect(controller.state.lastCheckedAt).toBeGreaterThan(t0)
    expect(controller.state.checkFailed).toBe(false)
  })

  it('Pruefungen aendern nie die laufende Sitzung: kein apply, keine Aktivierung', async () => {
    const { controller, pending, applied } = harness()
    await controller.restore()
    const runs = [controller.refreshFromStore(), controller.refreshFromStore()]
    pending[0].resolve(ready(2))
    pending[1].resolve(ready(3))
    await Promise.all(runs)
    expect(applied).toEqual([])
  })

  it('Fehler der neuesten Pruefung: die zuvor bekannten Bibliotheken bleiben als "zuletzt bekannter Stand" erhalten', async () => {
    const { controller, pending } = harness()
    await controller.restore()
    expect(versions(controller)).toEqual([1])
    const run = controller.refreshFromStore()
    pending[0].resolve(failed())
    await run
    expect(versions(controller)).toEqual([1])
    expect(controller.state.checkFailed).toBe(true)
  })
})

describe('disposed-Schutz', () => {
  const summary = (version) => ({ key: 'quiz:test-area', kind: 'quiz', areaId: 'test-area', libraryVersion: version, fileName: 'v.json', fingerprint: String(version), size: 1, savedAt: version, identity: { savedAt: version } })

  it('eine bei dispose() laufende Pruefung veraendert danach nichts mehr (Erfolg und Fehler)', async () => {
    for (const outcome of ['ready', 'error']) {
      const pending = []
      const applied = vi.fn()
      const controller = createPrivateLibraryController({
        persistence: {
          isSupported: () => true,
          load: async () => ({ status: 'ready', records: [summary(1)], files: [], invalid: [], missing: [] }),
          inspect: () => new Promise((resolve) => pending.push(resolve)),
        },
        getRegistries: () => ({ quiz: { libraryByAreaId: {}, conflictsByAreaId: {} }, coach: {}, figures: {}, practice: {} }),
        apply: { quiz: applied, coach: applied, figures: applied, practice: applied },
        sync: null,
        now: () => 777,
      })
      await controller.restore()
      const before = JSON.stringify(controller.state)
      const run = controller.refreshFromStore()
      controller.dispose()
      pending[0](outcome === 'ready' ? { status: 'ready', records: [summary(9)], invalid: [], missing: [] } : { status: 'error' })
      expect(await run).toBe(false)
      expect(JSON.stringify(controller.state)).toBe(before)
      expect(applied).not.toHaveBeenCalled()
    }
  })

  it('laeuft das Wiederherstellen bei dispose(), werden weder Zustand noch App-Register veraendert', async () => {
    const seed = tab()
    await seed.importFiles([fileOf(quizData(), 'quiz.json')])
    const real = createLibraryPersistence({ store: createPrivateLibraryStore() })
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const applied = vi.fn()
    const controller = createPrivateLibraryController({
      persistence: { ...real, isSupported: real.isSupported, load: async () => { await gate; return real.load() }, inspect: real.inspect },
      getRegistries: () => ({ quiz: { libraryByAreaId: {}, conflictsByAreaId: {} }, coach: { entry: null, conflict: null }, figures: { entry: null, conflict: null }, practice: { entry: null, conflict: null } }),
      apply: { quiz: applied, coach: applied, figures: applied, practice: applied },
      sync: null,
    })
    const running = controller.restore()
    controller.dispose()
    release()
    await running
    expect(applied).not.toHaveBeenCalled()
    expect(controller.state.records).toEqual([])
    expect(controller.state.lastCheckedAt).toBeNull()
  })

  it('dispose() schliesst BroadcastChannel und Listener; spaetere Signale loesen nichts mehr aus', async () => {
    const closed = []
    const listeners = []
    class Channel {
      constructor() { this.onmessage = null; listeners.push(this) }
      postMessage() {}
      close() { closed.push(this) }
    }
    const inspect = vi.fn(async () => ({ status: 'ready', records: [], invalid: [], missing: [] }))
    const sync = createSyncChannel({ BroadcastChannelImpl: Channel, win: window, doc: document })
    const controller = createPrivateLibraryController({
      persistence: { isSupported: () => true, load: async () => ({ status: 'ready', records: [], files: [], invalid: [], missing: [] }), inspect },
      getRegistries: () => ({ quiz: { libraryByAreaId: {}, conflictsByAreaId: {} }, coach: {}, figures: {}, practice: {} }),
      apply: { quiz() {}, coach() {}, figures() {}, practice() {} },
      sync,
    })
    await controller.restore()
    controller.dispose()
    expect(closed).toHaveLength(1)
    listeners[0].onmessage?.({ data: { type: 'private-libraries-changed', from: 'andere' } })
    window.dispatchEvent(new StorageEvent('storage', { key: 'businessEnglishStoredLibraries:v1' }))
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((done) => setTimeout(done, 20))
    expect(inspect).not.toHaveBeenCalled()
    expect(await controller.checkNow()).toBe(false)
  })

  it('Entfernen/Speichern nach dispose(): keine Zustandsaenderung, kein Versand', async () => {
    const a = tab()
    await a.importFiles([fileOf(quizData(), 'quiz.json')])
    const { snapshot } = await a.controller.prepareRemoval('quiz:test-area')
    const stateBefore = JSON.stringify(a.controller.state)
    const removal = a.controller.remove('quiz:test-area', snapshot)
    a.controller.dispose()
    await removal
    expect(JSON.stringify(a.controller.state)).toBe(stateBefore)
  })
})

describe('Regression: Speicherfehler beim Pruefen bleiben nachvollziehbar', () => {
  it('scheitert die Pruefung im Speicher selbst, bleibt der Stand "zuletzt bekannt"', async () => {
    const a = tab()
    await a.importFiles([fileOf(quizData(), 'quiz.json')])
    const checkedAt = a.controller.state.lastCheckedAt
    vi.spyOn(FDBObjectStore.prototype, 'openCursor').mockImplementation(() => {
      throw new DOMException('boom', 'UnknownError')
    })
    await a.controller.checkNow()
    vi.restoreAllMocks()
    expect(a.controller.state.checkFailed).toBe(true)
    expect(a.controller.state.lastCheckedAt).toBe(checkedAt)
    expect(a.controller.state.records).toHaveLength(1)
  })
})
