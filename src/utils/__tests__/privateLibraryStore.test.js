import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import FDBObjectStore from 'fake-indexeddb/lib/FDBObjectStore'
import {
  LIBRARY_KIND,
  PRIVATE_STORE_DB_NAME,
  PrivateStoreError,
  STORED_SCHEMA_VERSION,
  STORE_ERROR,
  createPrivateLibraryStore,
  identityOf,
  isStoredRecord,
  requestPersistentStorage,
} from '../privateLibraryStore.js'
import { fingerprintFile } from '../fingerprint.js'
import { fileOf, freshEnvironment, quizData, quotaError } from './privateStorageTestHelpers.js'

async function makeRecord({ key = 'quiz:test-area', kind = LIBRARY_KIND.QUIZ, data = quizData(), fileName = 'demo.json' } = {}) {
  const file = fileOf(data, fileName)
  const bytes = await file.arrayBuffer()
  return {
    key, kind, areaId: data.areaId, areaTitle: data.areaTitle, libraryId: data.libraryId, libraryVersion: data.libraryVersion,
    fileName, fingerprint: await fingerprintFile(file), size: bytes.byteLength, savedAt: Date.now(), schemaVersion: STORED_SCHEMA_VERSION, bytes,
  }
}

let store
beforeEach(() => {
  freshEnvironment()
  store = createPrivateLibraryStore()
})
afterEach(() => {
  store.close()
  vi.restoreAllMocks()
})

describe('privateLibraryStore: Speichern und Lesen', () => {
  it('legt einen Datensatz ab und liest die Original-Bytes unveraendert zurueck', async () => {
    const record = await makeRecord()
    await store.putIfNewer(record)
    const { records, corrupt } = await store.list()
    expect(corrupt).toEqual([])
    expect(records).toHaveLength(1)
    expect(new TextDecoder().decode(records[0].bytes)).toBe(JSON.stringify(quizData()))
    expect(records[0].fingerprint).toBe(record.fingerprint)
  })

  it('der Bestand ueberlebt Schliessen und erneutes Oeffnen (Neustart der App)', async () => {
    await store.putIfNewer(await makeRecord())
    store.close()
    const reopened = createPrivateLibraryStore()
    expect((await reopened.list()).records.map((entry) => entry.key)).toEqual(['quiz:test-area'])
    reopened.close()
  })

  it('ein erneutes put mit hoeherer Version ersetzt den Datensatz mit gleichem Schluessel (kein Duplikat)', async () => {
    await store.putIfNewer(await makeRecord())
    await store.putIfNewer(await makeRecord({ data: quizData({ libraryVersion: 2 }), fileName: 'demo-v2.json' }))
    const { records } = await store.list()
    expect(records).toHaveLength(1)
    expect(records[0].libraryVersion).toBe(2)
  })

  it('removeIfUnchanged loescht genau den angegebenen Schluessel', async () => {
    await store.putIfNewer(await makeRecord())
    await store.putIfNewer(await makeRecord({ key: 'coach', kind: LIBRARY_KIND.COACH, data: quizData({ areaId: 'w3-lerncoach', libraryId: 'coach-lib' }) }))
    const [quiz] = (await store.list()).records.filter((entry) => entry.key === 'quiz:test-area')
    await store.removeIfUnchanged('quiz:test-area', await store.readSnapshot(quiz.key))
    expect((await store.list()).records.map((entry) => entry.key)).toEqual(['coach'])
  })
})

describe('privateLibraryStore: nur JSON-Bibliotheken', () => {
  it.each(['audio', 'mp3', 'zip', 'audioPack', ''])('lehnt die Art "%s" ab', async (kind) => {
    const record = { ...(await makeRecord()), kind }
    expect(isStoredRecord(record)).toBe(false)
    await expect(store.putIfNewer(record)).rejects.toBeInstanceOf(PrivateStoreError)
    expect((await store.list()).records).toEqual([])
  })

  it('lehnt Datensaetze ohne Binaerdaten oder mit abweichender Groesse ab', async () => {
    const record = await makeRecord()
    await expect(store.putIfNewer({ ...record, bytes: 'text' })).rejects.toBeInstanceOf(PrivateStoreError)
    await expect(store.putIfNewer({ ...record, size: record.size + 1 })).rejects.toBeInstanceOf(PrivateStoreError)
    await expect(store.putIfNewer({ ...record, bytes: new ArrayBuffer(0), size: 0 })).rejects.toBeInstanceOf(PrivateStoreError)
  })

  it('lehnt Daten oberhalb der Import-Obergrenze von 5 MB ab (ohne sie zu schreiben)', async () => {
    const big = new ArrayBuffer(5 * 1024 * 1024 + 1)
    const record = { ...(await makeRecord()), bytes: big, size: big.byteLength }
    await expect(store.putIfNewer(record)).rejects.toMatchObject({ code: STORE_ERROR.QUOTA })
    expect((await store.list()).records).toEqual([])
  })
})

describe('privateLibraryStore: Fehlerfaelle', () => {
  it('Speicherplatz voll: Fehlercode quota, der bisherige Datensatz bleibt unveraendert', async () => {
    const original = await makeRecord()
    await store.putIfNewer(original)
    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quotaError()
    })
    await expect(store.putIfNewer(await makeRecord({ data: quizData({ libraryVersion: 2 }) }))).rejects.toMatchObject({ code: STORE_ERROR.QUOTA })
    vi.restoreAllMocks()
    const { records } = await store.list()
    expect(records).toHaveLength(1)
    expect(records[0].libraryVersion).toBe(1)
    expect(records[0].fingerprint).toBe(original.fingerprint)
  })

  it('ohne IndexedDB: nicht unterstuetzt, Lesen und Schreiben melden unavailable', async () => {
    globalThis.indexedDB = undefined
    const unsupported = createPrivateLibraryStore()
    expect(unsupported.isSupported()).toBe(false)
    await expect(unsupported.list()).rejects.toMatchObject({ code: STORE_ERROR.UNAVAILABLE })
    await expect(unsupported.putIfNewer(await makeRecord())).rejects.toMatchObject({ code: STORE_ERROR.UNAVAILABLE })
  })

  it('wenn open() haengt (bekanntes iOS-Verhalten), meldet der Speicher nach der Frist unavailable', async () => {
    const hanging = { open: () => ({}) }
    const timedOut = createPrivateLibraryStore({ indexedDB: hanging, openTimeoutMs: 20 })
    await expect(timedOut.list()).rejects.toMatchObject({ code: STORE_ERROR.UNAVAILABLE })
  })

  it('open() wirft synchron (z. B. SecurityError): unavailable', async () => {
    const throwing = { open: () => { throw new DOMException('denied', 'SecurityError') } }
    await expect(createPrivateLibraryStore({ indexedDB: throwing }).list()).rejects.toMatchObject({ code: STORE_ERROR.UNAVAILABLE })
  })

  it('beschaedigte Eintraege werden gemeldet, aber nicht geloescht', async () => {
    await store.putIfNewer(await makeRecord())
    const raw = await new Promise((done, fail) => {
      const request = indexedDB.open(PRIVATE_STORE_DB_NAME, 1)
      request.onsuccess = () => done(request.result)
      request.onerror = () => fail(request.error)
    })
    await new Promise((done, fail) => {
      const tx = raw.transaction('libraries', 'readwrite')
      tx.objectStore('libraries').put({ key: 'coach', kind: 'coach', fileName: 'x.json', bytes: 'kein-binaer' })
      tx.oncomplete = done
      tx.onerror = () => fail(tx.error)
    })
    raw.close()
    const { records, corrupt } = await store.list()
    expect(records.map((entry) => entry.key)).toEqual(['quiz:test-area'])
    expect(corrupt).toMatchObject([{ key: 'coach' }])
    expect((await store.list()).corrupt).toMatchObject([{ key: 'coach' }]) // weiterhin vorhanden
  })

  it('Fehlermeldungen enthalten keine Bibliotheksinhalte', async () => {
    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quotaError()
    })
    const error = await store.putIfNewer(await makeRecord({ data: quizData({ prompt: 'GEHEIMER-INHALT' }) })).catch((caught) => caught)
    expect(JSON.stringify({ message: error.message, name: error.name, cause: error.causeName })).not.toContain('GEHEIMER-INHALT')
  })
})

describe('requestPersistentStorage', () => {
  it('liefert true/false/null je nach Unterstuetzung und scheitert nie', async () => {
    expect(await requestPersistentStorage({ persist: async () => true })).toBe(true)
    expect(await requestPersistentStorage({ persist: async () => false })).toBe(false)
    expect(await requestPersistentStorage({ persisted: async () => true, persist: async () => false })).toBe(true)
    expect(await requestPersistentStorage({})).toBeNull()
    expect(await requestPersistentStorage({ persist: async () => { throw new Error('x') } })).toBeNull()
  })
})

describe('Datenschutz im Quellcode der Speichermodule', () => {
  const FILES = ['privateLibraryStore.js', 'privateLibraryPersistence.js', 'privateLibraryController.js', 'privateImportPipeline.js']
  it('kein Netzwerkzugriff, keine Cache-API, kein Service Worker, kein HTML-Auswerten', () => {
    for (const name of FILES) {
      const code = readFileSync(resolve(__dirname, '..', name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
      expect(code, name).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|caches\.|serviceWorker|innerHTML|\beval\s*\(|console\./)
    }
  })

  it('nur das Speichermodul selbst greift auf IndexedDB zu', () => {
    for (const name of FILES.filter((entry) => entry !== 'privateLibraryStore.js')) {
      expect(readFileSync(resolve(__dirname, '..', name), 'utf8'), name).not.toMatch(/indexedDB/)
    }
  })
})
