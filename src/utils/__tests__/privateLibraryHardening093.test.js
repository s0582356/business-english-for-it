// Auftrag 093: (1) Loeschschutz anhand der tatsaechlichen Bytes, (2) aktive Sitzung und gespeicherter Stand getrennt,
// auch bei verlorenen Synchronisierungssignalen. Alle Inhalte sind kuenstliche Demo-Daten.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FDBObjectStore from 'fake-indexeddb/lib/FDBObjectStore'
import FDBTransaction from 'fake-indexeddb/lib/FDBTransaction'
import { createPrivateLibraryController } from '../privateLibraryController.js'
import { PUT_OUTCOME, REMOVE_OUTCOME, STORED_SCHEMA_VERSION, createPrivateLibraryStore, snapshotOf } from '../privateLibraryStore.js'
import { createSyncChannel } from '../privateLibrarySync.js'
import { fileOf, freshEnvironment, quizData } from './privateStorageTestHelpers.js'
import { createFakeBroadcast, makeTab, storedSnapshot } from './privateTabHelpers.js'

const bytesOf = (...numbers) => new Uint8Array(numbers).buffer

function record(bytes, overrides = {}) {
  return {
    key: 'quiz:test-area', kind: 'quiz', areaId: 'test-area', areaTitle: 'Test Area', libraryId: 'quiz-test', libraryVersion: 1,
    fileName: 'demo.json', fingerprint: 'f'.repeat(64), size: bytes.byteLength, savedAt: 1000, schemaVersion: STORED_SCHEMA_VERSION, bytes, ...overrides,
  }
}

// Schreibt rohe Werte unter Umgehung jeder Pruefung (z. B. Metadaten, die nicht zu den Bytes passen).
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
const v = (version) => fileOf(quizData({ libraryVersion: version }), `v${version}.json`)

beforeEach(freshEnvironment)
afterEach(() => {
  vi.restoreAllMocks()
  while (stores.length) stores.pop().close()
  while (tabs.length) tabs.pop().close()
})

describe('A. Loeschschutz: tatsaechliche Bytes werden verglichen (Codex 092)', () => {
  it('ADVERSARIAL: Bytes [1,2,3,4] bestaetigt, dann [9,8,7,6] bei identischen Metadaten -> changed, Datensatz bleibt', async () => {
    const store = newStore()
    await store.forcePut(record(bytesOf(1, 2, 3, 4)))
    const confirmed = await store.readSnapshot('quiz:test-area') // Loeschbestaetigung wird vorbereitet
    await store.forcePut(record(bytesOf(9, 8, 7, 6))) // andere Bytes, alle Metadaten (Fingerabdruck, Groesse, savedAt, Version) gleich
    const { records } = await storedSnapshot()
    expect(records[0].fingerprint).toBe(confirmed.identity.fingerprint)
    expect(records[0].savedAt).toBe(confirmed.identity.savedAt)
    expect(records[0].size).toBe(confirmed.identity.size)

    const result = await store.removeIfUnchanged('quiz:test-area', confirmed)
    expect(result.outcome).toBe(REMOVE_OUTCOME.CHANGED)
    const after = await storedSnapshot()
    expect(after.records).toHaveLength(1)
    expect([...new Uint8Array(after.records[0].bytes)]).toEqual([9, 8, 7, 6])
  })

  it('gleiche Metadaten, aber andere Bytes ANDERER Laenge -> changed (Datensatz bleibt)', async () => {
    const store = newStore()
    await store.forcePut(record(bytesOf(1, 2, 3, 4)))
    const confirmed = await store.readSnapshot('quiz:test-area')
    // size-Feld bleibt 4, die Bytes sind jetzt 6 lang (nur per Rohschreiben moeglich, wie bei defekten Altdaten)
    await rawPut({ ...record(bytesOf(1, 2, 3, 4, 5, 6)), size: 4 })
    expect((await store.removeIfUnchanged('quiz:test-area', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    const after = await storedSnapshot()
    expect(after.records.length + after.corrupt.length).toBe(1) // Datensatz noch da (als beschaedigt gemeldet, da size nicht passt)
  })

  it('byteidentischer, vollstaendig unveraenderter Datensatz -> removed', async () => {
    const store = newStore()
    await store.forcePut(record(bytesOf(1, 2, 3, 4)))
    const confirmed = await store.readSnapshot('quiz:test-area')
    await store.forcePut(record(bytesOf(1, 2, 3, 4))) // neu geschrieben, aber inhaltlich identisch
    expect((await store.removeIfUnchanged('quiz:test-area', confirmed)).outcome).toBe(REMOVE_OUTCOME.REMOVED)
    expect((await storedSnapshot()).records).toEqual([])
  })

  it('der Snapshot ist eine unabhaengige Kopie: spaetere Aenderungen im Speicher veraendern ihn nicht', async () => {
    const store = newStore()
    const original = record(bytesOf(1, 2, 3, 4))
    await store.forcePut(original)
    const confirmed = await store.readSnapshot('quiz:test-area')
    await store.forcePut(record(bytesOf(9, 9, 9, 9)))
    expect([...new Uint8Array(confirmed.value.bytes)]).toEqual([1, 2, 3, 4])
    expect(confirmed.value.bytes).not.toBe(original.bytes)
  })

  it('zwischenzeitlich neuere Version -> changed, neuere bleibt', async () => {
    const store = newStore()
    await store.forcePut(record(bytesOf(1, 2, 3, 4)))
    const confirmed = await store.readSnapshot('quiz:test-area')
    await store.putIfNewer(record(bytesOf(5, 5, 5, 5), { libraryVersion: 2, fingerprint: 'e'.repeat(64) }))
    expect((await store.removeIfUnchanged('quiz:test-area', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@2'])
  })

  it('nur Metadaten reichen nicht: ein Snapshot ohne Inhaltsangabe loescht nie', async () => {
    const store = newStore()
    await store.forcePut(record(bytesOf(1, 2, 3, 4)))
    const { identity } = await store.readSnapshot('quiz:test-area')
    const metadataOnly = { identity }
    expect((await store.removeIfUnchanged('quiz:test-area', metadataOnly)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect((await storedSnapshot()).records).toHaveLength(1)
  })

  it('beschaedigter Legacy-Datensatz (Bytes als Text): kontrolliert entfernbar, aber nur wenn unveraendert', async () => {
    const store = newStore()
    await rawPut({ key: 'coach', savedAt: 5, fingerprint: 'abc', bytes: 'kaputter-text' })
    const confirmed = await store.readSnapshot('coach')
    expect(confirmed.value.bytes).toBe('kaputter-text')
    await rawPut({ key: 'coach', savedAt: 5, fingerprint: 'abc', bytes: 'anderer-text' }) // gleiche Metadaten, anderer Inhalt
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect((await store.list()).corrupt).toHaveLength(1)
    expect((await store.removeIfUnchanged('coach', await store.readSnapshot('coach'))).outcome).toBe(REMOVE_OUTCOME.REMOVED)
    expect((await store.list()).corrupt).toEqual([])
  })

  it('Legacy-Datensatz ohne Bytes und mit beschaedigten Metadaten: Vergleich bleibt stabil und erkennt Aenderungen', async () => {
    const store = newStore()
    await rawPut({ key: 'figures', savedAt: { kaputt: true }, size: NaN, fingerprint: 12345, bytes: null })
    const confirmed = await store.readSnapshot('figures')
    expect(confirmed.value.bytes).toBeNull()
    await rawPut({ key: 'figures', savedAt: { kaputt: true }, size: NaN, fingerprint: 12345, bytes: null, libraryVersion: 9 }) // Aenderung
    expect((await store.removeIfUnchanged('figures', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect((await store.removeIfUnchanged('figures', await store.readSnapshot('figures'))).outcome).toBe(REMOVE_OUTCOME.REMOVED)
  })

  it('konkurrierende Aktualisierung und Loeschung (beide Reihenfolgen): die neuere Version ueberlebt immer', async () => {
    for (const order of ['delete-first', 'put-first']) {
      const store = newStore()
      await store.forcePut(record(bytesOf(1, 2, 3, 4)))
      const confirmed = await store.readSnapshot('quiz:test-area')
      const update = () => store.putIfNewer(record(bytesOf(7, 7, 7, 7), { libraryVersion: 2, fingerprint: 'd'.repeat(64) }))
      const removal = () => store.removeIfUnchanged('quiz:test-area', confirmed)
      await Promise.all(order === 'delete-first' ? [removal(), update()] : [update(), removal()])
      expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@2'])
      await rawPut({ key: 'quiz:test-area', kind: 'x' }) // aufraeumen fuer die naechste Runde (ueberschreibt)
      const cleanup = await store.readSnapshot('quiz:test-area')
      await store.removeIfUnchanged('quiz:test-area', cleanup)
    }
  })

  it('zwei separate Verbindungen loeschen gleichzeitig: konsistenter Endzustand (einmal removed, einmal gone)', async () => {
    const one = newStore()
    const two = newStore()
    await one.forcePut(record(bytesOf(1, 2, 3, 4)))
    const snapshotOne = await one.readSnapshot('quiz:test-area')
    const snapshotTwo = await two.readSnapshot('quiz:test-area')
    const outcomes = (await Promise.all([one.removeIfUnchanged('quiz:test-area', snapshotOne), two.removeIfUnchanged('quiz:test-area', snapshotTwo)])).map((result) => result.outcome)
    expect(outcomes.sort()).toEqual([REMOVE_OUTCOME.GONE, REMOVE_OUTCOME.REMOVED])
    expect((await storedSnapshot()).records).toEqual([])
  })

  it('Transaktionsfehler (Ausnahme im delete): Fehler gemeldet, Datensatz bleibt, keine Erfolgsmeldung', async () => {
    const store = newStore()
    await store.forcePut(record(bytesOf(1, 2, 3, 4)))
    const confirmed = await store.readSnapshot('quiz:test-area')
    vi.spyOn(FDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw new DOMException('boom', 'UnknownError')
    })
    await expect(store.removeIfUnchanged('quiz:test-area', confirmed)).rejects.toMatchObject({ name: 'PrivateStoreError' })
    vi.restoreAllMocks()
    expect((await storedSnapshot()).records).toHaveLength(1)
  })

  it('abgebrochene Transaktion (abort nach delete): Fehler gemeldet, Datensatz bleibt', async () => {
    const store = newStore()
    await store.forcePut(record(bytesOf(1, 2, 3, 4)))
    const confirmed = await store.readSnapshot('quiz:test-area')
    const realDelete = FDBObjectStore.prototype.delete
    vi.spyOn(FDBObjectStore.prototype, 'delete').mockImplementation(function patched(...args) {
      const request = realDelete.apply(this, args)
      FDBTransaction.prototype.abort.call(this.transaction)
      return request
    })
    await expect(store.removeIfUnchanged('quiz:test-area', confirmed)).rejects.toBeTruthy()
    vi.restoreAllMocks()
    expect((await storedSnapshot()).records).toHaveLength(1)
  })

  it('der Vergleich ist synchron: kein await und kein crypto.subtle innerhalb von removeIfUnchanged', () => {
    const source = readFileSync(resolve(__dirname, '../privateLibraryStore.js'), 'utf8')
    const body = source.slice(source.indexOf('async function removeIfUnchanged'), source.indexOf('// Unbedingtes Schreiben'))
    const inner = body.slice(body.indexOf('atomic('))
    expect(inner).not.toMatch(/\bawait\b|crypto\.subtle|digest\(|setTimeout|fetch\(/)
    expect(inner).toMatch(/sameSnapshot\(existing, expectedSnapshot\)/)
  })

  it('snapshotOf: Metadaten-Identitaet und vollstaendige Wertkopie getrennt erfasst', () => {
    const snapshot = snapshotOf(record(bytesOf(1, 2)))
    expect(snapshot.identity).toMatchObject({ key: 'quiz:test-area', libraryVersion: 1, byteLength: 2 })
    expect(snapshot.value).toMatchObject({ key: 'quiz:test-area', libraryVersion: 1 })
  })
})

describe('A. Zusammenspiel mit dem Controller (gleiche Metadaten, andere Bytes)', () => {
  it('prepareRemoval -> andere Bytes im Speicher -> remove: NICHT entfernt, Meldung, Anzeige aktualisiert, Fortschritt unveraendert', async () => {
    window.localStorage.setItem('businessEnglishProgress:v2', '{"demo":1}')
    const a = tab()
    await a.importFiles([v(1)])
    const { snapshot } = await a.controller.prepareRemoval('quiz:test-area')
    const [stored] = (await storedSnapshot()).records
    const flipped = new Uint8Array(stored.bytes.slice(0))
    flipped[0] ^= 0xff // gleiche Laenge, gleiche Metadaten (Fingerabdruck/Groesse/savedAt/Version bleiben)
    await rawPut({ ...stored, bytes: flipped.buffer })

    expect(await a.controller.remove('quiz:test-area', snapshot)).toBe(false)
    expect((await storedSnapshot()).records).toHaveLength(1)
    expect(a.controller.state.notice).toContain('NICHT entfernt')
    expect(a.controller.state.noticeIsError).toBe(true)
    expect(window.localStorage.getItem('businessEnglishProgress:v2')).toBe('{"demo":1}')
    expect(a.activeVersion()).toBe(1)
  })

  it('Fehler waehrend des Entfernens: keine Erfolgsmeldung, Datensatz bleibt', async () => {
    const a = tab()
    await a.importFiles([v(1)])
    const { snapshot } = await a.controller.prepareRemoval('quiz:test-area')
    vi.spyOn(FDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw new DOMException('boom', 'UnknownError')
    })
    expect(await a.controller.remove('quiz:test-area', snapshot)).toBe(false)
    vi.restoreAllMocks()
    expect(a.controller.state.notice).toContain('konnte nicht entfernt werden')
    expect(a.controller.state.notice).not.toContain('Gespeicherte Bibliothek entfernt')
    expect((await storedSnapshot()).records).toHaveLength(1)
  })

  it('prepareRemoval merkt, wenn die Anzeige nicht mehr dem Speicher entspricht, und oeffnet keine Rueckfrage', async () => {
    const a = tab()
    const b = tab()
    await a.importFiles([v(1)])
    await b.importFiles([v(2)]) // A zeigt noch Version 1
    const prepared = await a.controller.prepareRemoval('quiz:test-area')
    expect(prepared).toEqual({ changed: true })
    expect(a.controller.state.records.map((entry) => entry.libraryVersion)).toEqual([2])
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@2'])
  })

  it('remove ohne Snapshot loescht nichts', async () => {
    const a = tab()
    await a.importFiles([v(1)])
    expect(await a.controller.remove('quiz:test-area', undefined)).toBe(false)
    expect((await storedSnapshot()).records).toHaveLength(1)
  })
})

describe('B. Verlorene Synchronisierung: aktive Sitzung und gespeicherter Stand sind getrennt', () => {
  it('B aktiv mit Version 2, A speichert Version 3, alle Signale an B gehen verloren', async () => {
    let clock = 1_000
    const { FakeBroadcastChannel } = createFakeBroadcast({ drop: true })
    const lost = () => createSyncChannel({ BroadcastChannelImpl: FakeBroadcastChannel, win: null, doc: null })
    const a = tab({ sync: lost() })
    const b = tab({ sync: lost(), now: () => clock })
    await Promise.all([a.restore(), b.restore()])
    await b.importFiles([v(2)])
    expect(b.activeVersion()).toBe(2)
    const checkedBefore = b.controller.state.lastCheckedAt

    clock = 5_000
    await a.importFiles([v(3)])
    await new Promise((done) => setTimeout(done, 20))

    // B hat nichts mitbekommen: die aktive Sitzung bleibt, der Anzeigestand stammt aus der letzten Pruefung (nicht aus "jetzt").
    expect(b.activeVersion()).toBe(2)
    expect(b.controller.state.records.map((entry) => entry.libraryVersion)).toEqual([2])
    expect(b.controller.state.lastCheckedAt).toBe(checkedBefore)
    expect(b.controller.state.lastCheckedAt).toBeLessThan(clock)

    // Der Speicherbereich wird (erneut) geoeffnet: der tatsaechliche IndexedDB-Stand wird gelesen.
    await b.controller.checkNow()
    expect(b.controller.state.records.map((entry) => entry.libraryVersion)).toEqual([3])
    expect(b.controller.state.lastCheckedAt).toBe(5_000)
    expect(b.controller.state.notice).toContain('in einem anderen Tab oder Fenster geändert')
    expect(b.activeVersion()).toBe(2) // die laufende Sitzung bleibt unveraendert
    expect(b.registries.quiz.libraryByAreaId['test-area'].library.libraryVersion).toBe(2)
    expect(b.controller.isActive(b.controller.state.records[0])).toBe(false) // aktive Version 2 ist NICHT die gespeicherte Version 3

    // Neustart: Version 3 wird aktiviert.
    const restart = tab()
    await restart.restore()
    expect(restart.activeVersion()).toBe(3)
  })

  it('ein ueberholtes (aeltere) Pruefergebnis ueberschreibt kein neueres', async () => {
    const resolvers = []
    const summary = (version) => ({ key: 'quiz:test-area', kind: 'quiz', areaId: 'test-area', libraryVersion: version, fileName: `v${version}.json`, fingerprint: String(version), size: 1, savedAt: version, identity: { savedAt: version } })
    const persistence = {
      isSupported: () => true,
      load: async () => ({ status: 'ready', records: [], files: [], invalid: [], missing: [] }),
      inspect: () => new Promise((resolve) => resolvers.push(resolve)),
    }
    const controller = createPrivateLibraryController({
      persistence,
      getRegistries: () => ({ quiz: { libraryByAreaId: {}, conflictsByAreaId: {} }, coach: {}, figures: {}, practice: {} }),
      apply: { quiz() {}, coach() {}, figures() {}, practice() {} },
      sync: null,
      now: (() => { let tick = 0; return () => ++tick })(),
    })
    await controller.restore()
    const older = controller.refreshFromStore() // startet zuerst, liest "Version 2"
    const newer = controller.refreshFromStore() // startet spaeter, liest "Version 3"
    resolvers[1]({ status: 'ready', records: [summary(3)], invalid: [], missing: [] })
    expect(await newer).toBe(true)
    resolvers[0]({ status: 'ready', records: [summary(2)], invalid: [], missing: [] }) // kommt zu spaet
    expect(await older).toBe(false)
    expect(controller.state.records.map((entry) => entry.libraryVersion)).toEqual([3])
    controller.dispose()
  })

  it('misslungene Pruefung: alter Anzeigestand bleibt, aber als solcher markiert (lastCheckedAt unveraendert, checkFailed)', async () => {
    let fail = false
    const real = {
      isSupported: () => true,
      load: async () => ({ status: 'ready', records: [], files: [], invalid: [], missing: [] }),
      inspect: async () => (fail ? { status: 'error', records: [], files: [], invalid: [], missing: [] } : { status: 'ready', records: [], files: [], invalid: [], missing: [] }),
    }
    let clock = 100
    const controller = createPrivateLibraryController({
      persistence: real,
      getRegistries: () => ({ quiz: { libraryByAreaId: {}, conflictsByAreaId: {} }, coach: {}, figures: {}, practice: {} }),
      apply: { quiz() {}, coach() {}, figures() {}, practice() {} },
      sync: null,
      now: () => clock,
    })
    await controller.restore()
    expect(controller.state.lastCheckedAt).toBe(100)
    fail = true
    clock = 900
    await controller.checkNow()
    expect(controller.state.checkFailed).toBe(true)
    expect(controller.state.lastCheckedAt).toBe(100)
    fail = false
    await controller.checkNow()
    expect(controller.state.checkFailed).toBe(false)
    expect(controller.state.lastCheckedAt).toBe(900)
    controller.dispose()
  })

  it('Synchronisierungssignale loesen nur ein Neulesen aus: kein Reimport, keine Aenderung der aktiven Sitzung', async () => {
    const { FakeBroadcastChannel } = createFakeBroadcast()
    const live = () => createSyncChannel({ BroadcastChannelImpl: FakeBroadcastChannel, win: null, doc: null })
    const a = tab({ sync: live() })
    const b = tab({ sync: live() })
    await Promise.all([a.restore(), b.restore()])
    await b.importFiles([v(2)])
    const registryBefore = b.registries.quiz
    await a.importFiles([v(3)])
    await vi.waitFor(() => expect(b.controller.state.records.map((entry) => entry.libraryVersion)).toEqual([3]))
    expect(b.activeVersion()).toBe(2)
    expect(b.registries.quiz).toBe(registryBefore) // kein Reimport, kein apply
  })
})
