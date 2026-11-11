// Auftrag 091: Versions-Race, sicheres Entfernen und Tab-Synchronisierung der lokal gespeicherten JSON-Bibliotheken.
// "Tab" = eigener Controller/Store mit gemeinsamem IndexedDB-Bestand. Alle Inhalte sind kuenstliche Demo-Daten.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { importLibraryFiles } from '../libraryImport.js'
import { collectAcceptedRecords } from '../privateLibraryPersistence.js'
import { LIBRARY_KIND, PUT_OUTCOME, REMOVE_OUTCOME, createPrivateLibraryStore, identityOf } from '../privateLibraryStore.js'
import { STORED_MARKER_KEY } from '../privateLibraryPersistence.js'
import { SYNC_CHANNEL_NAME, SYNC_MESSAGE_TYPE, createSyncChannel } from '../privateLibrarySync.js'
import { coachLibraryData } from './coachTestHelpers.js'
import { figureData } from './figureTestHelpers.js'
import { fileOf, freshEnvironment, quizData } from './privateStorageTestHelpers.js'
import { createFakeBroadcast, makeTab, storedSnapshot } from './privateTabHelpers.js'

const tabs = []
const tab = (options) => {
  const created = makeTab(options)
  tabs.push(created)
  return created
}
const v = (version, extra = {}) => fileOf(quizData({ libraryVersion: version, ...extra }), `v${version}.json`)

beforeEach(freshEnvironment)
afterEach(() => {
  while (tabs.length) tabs.pop().close()
  vi.unstubAllGlobals()
})

async function recordFor(version, extra) {
  const file = v(version, extra)
  const result = await importLibraryFiles([file])
  const [record] = await collectAcceptedRecords(LIBRARY_KIND.QUIZ, [file], result)
  return record
}

describe('A. Store: atomares putIfNewer (die Regeln A-F)', () => {
  it('Fall A/B/C/D/E: neu, hoeher, niedriger, Duplikat, Konflikt', async () => {
    const store = createPrivateLibraryStore()
    expect((await store.putIfNewer(await recordFor(2))).outcome).toBe(PUT_OUTCOME.SAVED) // A
    expect((await store.putIfNewer(await recordFor(3))).outcome).toBe(PUT_OUTCOME.SAVED) // B
    const stale = await store.putIfNewer(await recordFor(2)) // C
    expect(stale.outcome).toBe(PUT_OUTCOME.STALE)
    expect(stale.stored.libraryVersion).toBe(3)
    const before = (await storedSnapshot()).records[0].savedAt
    expect((await store.putIfNewer(await recordFor(3))).outcome).toBe(PUT_OUTCOME.DUPLICATE) // D
    expect((await storedSnapshot()).records[0].savedAt).toBe(before) // keine unnoetige Aenderung
    expect((await store.putIfNewer(await recordFor(3, { prompt: 'Andere Frage?' }))).outcome).toBe(PUT_OUTCOME.CONFLICT) // E
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@3'])
    store.close()
  })

  it('andere Bibliotheks-ID unter demselben Schluessel ist ein Konflikt, nichts wird ueberschrieben', async () => {
    const store = createPrivateLibraryStore()
    await store.putIfNewer(await recordFor(1))
    const other = await recordFor(9, { libraryId: 'andere-bibliothek' })
    expect((await store.putIfNewer(other)).outcome).toBe(PUT_OUTCOME.CONFLICT)
    expect((await storedSnapshot()).records[0].libraryId).toBe('quiz-test')
    store.close()
  })

  it('echte Ueberlappung: viele gleichzeitige Schreibvorgaenge ueber mehrere Verbindungen enden immer bei der hoechsten Version', async () => {
    const stores = [createPrivateLibraryStore(), createPrivateLibraryStore(), createPrivateLibraryStore()]
    const versions = [2, 5, 1, 4, 3, 6, 2, 5, 7, 1, 3, 4]
    const records = await Promise.all(versions.map((version) => recordFor(version)))
    const results = await Promise.all(records.map((record, index) => stores[index % stores.length].putIfNewer(record)))
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@7'])
    // Jede Antwort ist in sich stimmig: nach einem SAVED darf nie eine niedrigere Version als "saved" gemeldet worden sein
    // ohne dass die hoehere vorher/nachher gespeichert war; "stale" nennt immer eine hoehere gespeicherte Version.
    for (const [index, result] of results.entries()) {
      if (result.outcome === PUT_OUTCOME.STALE) expect(result.stored.libraryVersion).toBeGreaterThan(versions[index])
    }
    expect(results.some((result) => result.outcome === PUT_OUTCOME.SAVED && result.stored.libraryVersion === 7)).toBe(true)
    stores.forEach((entry) => entry.close())
  })
})

describe('A. Zwei unabhaengige Tabs (gemeinsamer Bestand)', () => {
  it('1. Tab A speichert Version 3, der veraltete Tab B versucht Version 2: Version 3 bleibt erhalten', async () => {
    const a = tab()
    const b = tab() // B hat nie neu geladen und weiss nichts von Version 3
    await a.restore()
    await b.restore()
    await a.importFiles([v(3)])
    await b.importFiles([v(2)])

    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@3'])
    expect(b.activeVersion()).toBe(2) // in B bleibt die Sitzung nutzbar
    expect(b.controller.state.saveRejections).toMatchObject([{ key: 'quiz:test-area', outcome: 'stale', incomingVersion: 2, storedVersion: 3 }])
    expect(b.controller.state.records.map((record) => record.libraryVersion)).toEqual([3]) // Anzeige zeigt den echten Stand
    const restart = tab()
    await restart.restore()
    expect(restart.activeVersion()).toBe(3)
  })

  it.each([
    ['A zuerst', ['a', 'b']],
    ['B zuerst', ['b', 'a']],
  ])('2. gleichzeitige Schreibvorgaenge verschiedener Versionen (%s): am Ende steht die hoechste', async (_label, order) => {
    const a = tab()
    const b = tab()
    await Promise.all([a.restore(), b.restore()])
    const work = { a: () => a.importFiles([v(2)]), b: () => b.importFiles([v(3)]) }
    await Promise.all(order.map((name) => work[name]()))
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@3'])
  })

  it('3. gleiche Version, gleicher Fingerabdruck: Duplikat, keine Aenderung, keine Meldung', async () => {
    const a = tab()
    const b = tab()
    await a.importFiles([v(3)])
    const before = (await storedSnapshot()).records[0].savedAt
    await new Promise((done) => setTimeout(done, 10))
    await b.importFiles([fileOf(quizData({ libraryVersion: 3 }), 'kopie.json')])
    expect((await storedSnapshot()).records[0].savedAt).toBe(before)
    expect(b.controller.state.saveRejections).toEqual([])
    expect(b.controller.state.saveProblems).toEqual([])
  })

  it('4. gleiche Version, verschiedener Fingerabdruck: Konflikt, nichts wird ueberschrieben', async () => {
    const a = tab()
    const b = tab()
    await a.importFiles([v(3)])
    const original = (await storedSnapshot()).records[0].fingerprint
    await b.importFiles([v(3, { prompt: 'Andere Frage?' })])
    expect((await storedSnapshot()).records[0].fingerprint).toBe(original)
    expect(b.controller.state.saveRejections).toMatchObject([{ outcome: 'conflict', incomingVersion: 3, storedVersion: 3 }])
  })

  it('5. A bestaetigt das Loeschen einer alten Version, B speichert vorher eine neuere: die neue Version bleibt', async () => {
    const a = tab()
    const b = tab()
    await a.importFiles([v(1)])
    await b.restore()
    const shownToUser = (await a.controller.prepareRemoval('quiz:test-area')).snapshot // A zeigt Version 1 und bekommt die Bestaetigung
    await b.importFiles([v(2)]) // B ersetzt sie inzwischen
    const removed = await a.controller.remove('quiz:test-area', shownToUser)

    expect(removed).toBe(false)
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@2'])
    expect(a.controller.state.notice).toContain('NICHT entfernt')
    expect(a.controller.state.noticeIsError).toBe(true)
    expect(a.controller.state.records.map((record) => record.libraryVersion)).toEqual([2]) // Anzeige aktualisiert
    expect(a.activeVersion()).toBe(1) // die laufende Sitzung wurde nicht angefasst
  })

  it('5b. dieselbe Datei wurde inzwischen neu gespeichert (gleiche Version): die alte Bestaetigung loescht sie ebenfalls nicht', async () => {
    const a = tab()
    const b = tab()
    await a.importFiles([v(1)])
    const shown = (await a.controller.prepareRemoval('quiz:test-area')).snapshot
    await new Promise((done) => setTimeout(done, 5))
    const store = createPrivateLibraryStore()
    const [existing] = (await storedSnapshot()).records
    await store.forcePut({ ...existing, savedAt: existing.savedAt + 1000 }) // Neuschreiben (z. B. nach Reparatur) in anderem Tab
    store.close()
    expect(await a.controller.remove('quiz:test-area', shown)).toBe(false)
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@1'])
    await b.restore()
  })

  it('6. zwei gleichzeitige Loeschversuche: konsistenter Endzustand (einer entfernt, einer "schon weg")', async () => {
    const a = tab()
    const b = tab()
    await a.importFiles([v(1)])
    await b.restore()
    const snapshotA = (await a.controller.prepareRemoval('quiz:test-area')).snapshot
    const snapshotB = (await b.controller.prepareRemoval('quiz:test-area')).snapshot
    const results = await Promise.all([a.controller.remove('quiz:test-area', snapshotA), b.controller.remove('quiz:test-area', snapshotB)])
    expect(results).toEqual([true, true]) // beide Ergebnisse sind Erfolge: entfernt bzw. bereits entfernt
    expect((await storedSnapshot()).keys).toEqual([])
    expect(window.localStorage.getItem(STORED_MARKER_KEY)).toBeNull()
    const notices = [a.controller.state.notice, b.controller.state.notice]
    expect(notices.filter((text) => text.includes('war bereits entfernt'))).toHaveLength(1)
    expect(notices.filter((text) => text.startsWith('Gespeicherte Bibliothek entfernt'))).toHaveLength(1)
  })

  it('7. ohne jede Synchronisierungsnachricht (Nachrichten gehen verloren) schuetzt der atomare Speicher trotzdem', async () => {
    const { FakeBroadcastChannel, log } = createFakeBroadcast({ drop: true })
    const a = tab({ sync: createSyncChannel({ BroadcastChannelImpl: FakeBroadcastChannel, win: null, doc: null }) })
    const b = tab({ sync: createSyncChannel({ BroadcastChannelImpl: FakeBroadcastChannel, win: null, doc: null }) })
    await Promise.all([a.restore(), b.restore()])
    await a.importFiles([v(3)])
    await flushPromises()
    expect(log.length).toBeGreaterThan(0) // gesendet, aber nie angekommen
    expect(b.controller.state.records).toEqual([]) // B ist veraltet ...
    await b.importFiles([v(2)]) // ... darf aber nichts zerstoeren
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@3'])
    const snapshotB = await b.store.readSnapshot('quiz:test-area') // frisch gelesen
    expect(await b.controller.remove('quiz:test-area', { ...snapshotB, value: { ...snapshotB.value, savedAt: 1 } })).toBe(false)
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@3'])
  })

  it('8. Aktualisierung und Wiederherstellung laufen gleichzeitig: kein veralteter Stand ersetzt den neueren', async () => {
    const a = tab()
    await a.importFiles([v(2)])
    const b = tab()
    const c = tab()
    // B stellt wieder her (liest v2), waehrend A auf 3 aktualisiert und C gleichzeitig noch Version 2/1 importiert.
    await Promise.all([b.restore(), a.importFiles([v(3)]), c.importFiles([v(1)]), c.importFiles([v(2)])])
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@3'])
    // Auch ein Import in B mit dem eben wiederhergestellten (jetzt veralteten) Stand aendert nichts.
    await b.importFiles([v(2)])
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@3'])
    const restart = tab()
    await restart.restore()
    expect(restart.activeVersion()).toBe(3)
  })

  it('beschaedigter Datensatz laesst sich durch einen gueltigen Import reparieren (auch bei gleicher Version)', async () => {
    const a = tab()
    await a.importFiles([v(1)])
    const store = createPrivateLibraryStore()
    const [existing] = (await storedSnapshot()).records
    const bytes = new TextEncoder().encode('{"manipuliert":true}').buffer
    await store.forcePut({ ...existing, bytes, size: bytes.byteLength })
    store.close()
    const b = tab()
    await b.importFiles([v(1)])
    const { records } = await storedSnapshot()
    expect(new TextDecoder().decode(records[0].bytes)).toBe(JSON.stringify(quizData({ libraryVersion: 1 })))
  })
})

describe('A. Sicheres Entfernen: Identitaet', () => {
  it('beschaedigte Eintraege (Struktur kaputt) haben eine vergleichbare Identitaet; ein Austausch wird erkannt', async () => {
    const store = createPrivateLibraryStore()
    const raw = await new Promise((done, fail) => {
      const request = indexedDB.open('businessEnglishPrivateLibraries', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('libraries', { keyPath: 'key' })
      request.onsuccess = () => done(request.result)
      request.onerror = () => fail(request.error)
    })
    const put = (value) => new Promise((done, fail) => {
      const tx = raw.transaction('libraries', 'readwrite')
      tx.objectStore('libraries').put(value)
      tx.oncomplete = done
      tx.onerror = () => fail(tx.error)
    })
    await put({ key: 'coach', savedAt: 111, bytes: 'kein-binaer', fingerprint: 'abc' })
    const confirmed = await store.readSnapshot('coach')
    await put({ key: 'coach', savedAt: 222, bytes: 'kein-binaer', fingerprint: 'abc' }) // anderer Tab ersetzt den defekten Eintrag
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect((await store.list()).corrupt).toHaveLength(1)
    const current = await store.readSnapshot('coach')
    expect((await store.removeIfUnchanged('coach', current)).outcome).toBe(REMOVE_OUTCOME.REMOVED)
    expect((await store.list()).corrupt).toEqual([])
    raw.close()
    store.close()
  })

  it('removeIfUnchanged verlangt eine Identitaet (kein unbedingtes Loeschen)', async () => {
    const store = createPrivateLibraryStore()
    await store.putIfNewer(await recordFor(1))
    await expect(store.removeIfUnchanged('quiz:test-area')).rejects.toBeTruthy()
    await expect(store.removeIfUnchanged('quiz:test-area', null)).rejects.toBeTruthy()
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@1'])
    expect(identityOf((await storedSnapshot()).records[0]).byteLength).toBeGreaterThan(0)
    store.close()
  })
})

describe('B. Alle vier JSON-Arten nach simuliertem Neustart', () => {
  it('Quiz, Lerncoach, Diagramm-Figuren und W3-Uebungen werden validiert und aktiviert', async () => {
    const a = tab()
    await a.importFiles([fileOf(quizData(), 'quiz.json'), fileOf(coachLibraryData(), 'coach.json'), fileOf(figureData(), 'figuren.json')])
    expect((await storedSnapshot()).keys).toEqual(['coach@1', 'figures@1', 'quiz:test-area@1'])
    a.close()

    const b = tab() // Neustart
    await b.restore()
    expect(b.controller.state.status).toBe('ready')
    expect(Object.keys(b.registries.quiz.libraryByAreaId)).toEqual(['test-area'])
    expect(b.registries.coach.entry.library.units.length).toBeGreaterThan(0)
    expect(b.registries.figures.entry.library.figures).toHaveLength(2)
    for (const entry of [b.registries.quiz.libraryByAreaId['test-area'], b.registries.coach.entry, b.registries.figures.entry]) {
      expect(entry.fingerprint).toMatch(/^[0-9a-f]{64}$/) // frisch aus den gespeicherten Bytes berechnet
    }
    expect(b.controller.state.records.map((record) => record.kind).sort()).toEqual(['coach', 'figures', 'quiz'])
    expect(b.controller.state.records.every((record) => b.controller.isActive(record))).toBe(true)
    expect(b.controller.state.invalid).toEqual([])
  })

  it('Figuren und Uebungen lassen sich einzeln aktualisieren, ein veralteter Tab ueberschreibt sie nicht', async () => {
    const a = tab()
    const b = tab()
    await a.importFiles([fileOf(figureData(), 'f.json')])
    await b.importFiles([fileOf(figureData(), 'f.json')])
    await a.importFiles([fileOf({ ...figureData(), libraryVersion: 2 }, 'f2.json'.replace('f2', 'f'))])
    expect((await storedSnapshot()).keys).toEqual(['figures@2'])
  })
})

describe('Tab-Synchronisierung: nur Anzeige, ohne Inhalte', () => {
  const syncOptions = (BroadcastChannelImpl) => ({ BroadcastChannelImpl, win: window, doc: document })

  it('eine Aenderung in Tab A aktualisiert die Anzeige in Tab B und meldet sie verstaendlich', async () => {
    const { FakeBroadcastChannel, log } = createFakeBroadcast()
    const a = tab({ sync: createSyncChannel(syncOptions(FakeBroadcastChannel)) })
    const b = tab({ sync: createSyncChannel(syncOptions(FakeBroadcastChannel)) })
    await Promise.all([a.restore(), b.restore()])
    await a.importFiles([v(3, { prompt: 'GEHEIMER-INHALT' })])

    await vi.waitFor(() => expect(b.controller.state.records.map((record) => record.libraryVersion)).toEqual([3]), { timeout: 2000 })
    expect(b.controller.state.notice).toContain('in einem anderen Tab oder Fenster geändert')
    expect(b.activeVersion()).toBeNull() // Import/Aktivierung passiert NICHT durch die Synchronisierung
    // Datenschutz: nur { type, from }, keine Inhalte, Namen, Versionen
    expect(log).toHaveLength(1)
    expect(Object.keys(log[0]).sort()).toEqual(['from', 'type'])
    expect(log[0].type).toBe(SYNC_MESSAGE_TYPE)
    expect(JSON.stringify(log)).not.toMatch(/GEHEIMER|v3\.json|test-area|libraryVersion/)
  })

  it('keine Endlosschleife: das Neulesen in B sendet nichts zurueck', async () => {
    const { FakeBroadcastChannel, log } = createFakeBroadcast()
    const a = tab({ sync: createSyncChannel(syncOptions(FakeBroadcastChannel)) })
    const b = tab({ sync: createSyncChannel(syncOptions(FakeBroadcastChannel)) })
    await Promise.all([a.restore(), b.restore()])
    await a.importFiles([v(1)])
    await vi.waitFor(() => expect(b.controller.state.records).toHaveLength(1))
    await new Promise((done) => setTimeout(done, 50))
    expect(log).toHaveLength(1)
  })

  it('Fortschritt (localStorage) bleibt bei der Synchronisierung unberuehrt', async () => {
    const { FakeBroadcastChannel } = createFakeBroadcast()
    window.localStorage.setItem('businessEnglishProgress:v2', '{"demo":1}')
    const a = tab({ sync: createSyncChannel(syncOptions(FakeBroadcastChannel)) })
    const b = tab({ sync: createSyncChannel(syncOptions(FakeBroadcastChannel)) })
    await Promise.all([a.restore(), b.restore()])
    await a.importFiles([v(1)])
    await vi.waitFor(() => expect(b.controller.state.records).toHaveLength(1))
    expect(window.localStorage.getItem('businessEnglishProgress:v2')).toBe('{"demo":1}')
  })

  it('Ausloeser ohne BroadcastChannel: storage-Ereignis der Merkliste und erneutes Sichtbarwerden', async () => {
    const a = tab({ sync: null })
    const b = tab({ sync: createSyncChannel({ BroadcastChannelImpl: undefined, win: window, doc: document }) })
    await Promise.all([a.restore(), b.restore()])
    await a.importFiles([v(1)])
    expect(b.controller.state.records).toEqual([]) // noch nichts bemerkt
    window.dispatchEvent(new StorageEvent('storage', { key: STORED_MARKER_KEY }))
    await vi.waitFor(() => expect(b.controller.state.records).toHaveLength(1))

    await a.importFiles([v(2)])
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(b.controller.state.records.map((record) => record.libraryVersion)).toEqual([2]))
  })

  it('fremde oder fehlerhafte Nachrichten und fremde Storage-Schluessel loesen nichts aus', async () => {
    const { FakeBroadcastChannel } = createFakeBroadcast()
    const sync = createSyncChannel(syncOptions(FakeBroadcastChannel))
    const listener = vi.fn()
    sync.onChange(listener)
    const outsider = new FakeBroadcastChannel(SYNC_CHANNEL_NAME)
    outsider.postMessage({ type: 'etwas-anderes', from: 'x' })
    outsider.postMessage({ type: SYNC_MESSAGE_TYPE })
    outsider.postMessage('text')
    window.dispatchEvent(new StorageEvent('storage', { key: 'anderer-schluessel' }))
    await new Promise((done) => setTimeout(done, 20))
    expect(listener).not.toHaveBeenCalled()
    outsider.postMessage({ type: SYNC_MESSAGE_TYPE, from: 'andere-instanz' })
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
    sync.close()
  })
})
