// Lokaler IndexedDB-Speicher fuer die importierten Audio-Packs (ZIP-Dateien, Auftrag 103).
//
// Je Pack wird die ORIGINALE ZIP-Datei als ein Blob abgelegt (kein Eintrag pro MP3). Beim naechsten Start laufen die
// gespeicherten ZIPs durch denselben Importpfad wie frisch gewaehlte Dateien (loadAudioPacks/addPack): erneute
// Pruefung, gleiche Regeln, gleiche Anzeige. Die Daten verlassen das Geraet nie.
//
// Eigene Datenbank, getrennt von den JSON-Bibliotheken: ein Speicherfehler (z. B. Platz voll) kann den JSON-Bestand
// nie beruehren. Jedes ZIP wird in einer eigenen Transaktion geschrieben; scheitert eine, bleibt der bisherige Eintrag
// dieses Packs und bleiben alle anderen Packs unveraendert. Der Schluessel ist der ZIP-Dateiname, drei verschiedene
// Packs ueberschreiben sich daher nie gegenseitig; dasselbe ZIP erneut importiert ersetzt nur seinen eigenen Eintrag.
// Es gibt keine automatische Loeschung.

import { PrivateStoreError, STORE_ERROR, mapError, requestPersistentStorage } from './privateLibraryStore.js'
import { reactive } from 'vue'

export const AUDIO_STORE_DB_NAME = 'businessEnglishAudioPacks'
const DB_VERSION = 1
const OBJECT_STORE = 'packs'
const OPEN_TIMEOUT_MS = 8000
const ZIP_TYPE = 'application/zip'

function isPackRecord(record) {
  return Boolean(record) && typeof record.fileName === 'string' && record.fileName !== '' && record.blob instanceof Blob && record.blob.size > 0
}

export function createAudioPackStore({ indexedDB: factoryOverride, dbName = AUDIO_STORE_DB_NAME, openTimeoutMs = OPEN_TIMEOUT_MS } = {}) {
  const factory = () => factoryOverride ?? globalThis.indexedDB
  const isSupported = () => Boolean(factory())

  function open() {
    return new Promise((resolve, reject) => {
      const idb = factory()
      if (!idb) {
        reject(new PrivateStoreError(STORE_ERROR.UNAVAILABLE))
        return
      }
      let settled = false
      // Manche iOS-Versionen lassen indexedDB.open beim Kaltstart haengen: kontrolliert melden statt ewig warten.
      const timer = setTimeout(() => {
        settled = true
        reject(new PrivateStoreError(STORE_ERROR.UNAVAILABLE))
      }, openTimeoutMs)
      let request
      try {
        request = idb.open(dbName, DB_VERSION)
      } catch (error) {
        clearTimeout(timer)
        reject(mapError(error))
        return
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE, { keyPath: 'fileName' })
      }
      request.onblocked = () => {
        clearTimeout(timer)
        settled = true
        reject(new PrivateStoreError(STORE_ERROR.BLOCKED))
      }
      request.onerror = () => {
        clearTimeout(timer)
        if (!settled) reject(mapError(request.error))
        settled = true
      }
      request.onsuccess = () => {
        clearTimeout(timer)
        if (settled) request.result.close()
        else resolve(request.result)
        settled = true
      }
    })
  }

  // Eine Transaktion; die Verbindung wird danach wieder geschlossen (seltene Zugriffe, keine veraltete Verbindung).
  async function run(mode, work) {
    const db = await open()
    try {
      return await new Promise((resolve, reject) => {
        let result
        let transaction
        try {
          transaction = db.transaction(OBJECT_STORE, mode)
        } catch (error) {
          reject(error)
          return
        }
        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error ?? new Error('Transaktion abgebrochen.'))
        try {
          work(transaction.objectStore(OBJECT_STORE), (value) => { result = value })
        } catch (error) {
          try { transaction.abort() } catch { /* bereits beendet */ }
          reject(error)
        }
      })
    } catch (error) {
      throw mapError(error)
    } finally {
      db.close()
    }
  }

  // Alle gueltigen Eintraege { fileName, blob, size, lastModified, savedAt }. Unbrauchbare Eintraege werden
  // uebergangen, aber nicht geloescht.
  const list = () =>
    run('readonly', (store, setResult) => {
      const request = store.getAll()
      request.onsuccess = () => setResult((request.result ?? []).filter(isPackRecord))
    })

  // Schreibt das ZIP unter seinem Dateinamen (ersetzt nur den eigenen Eintrag).
  const put = (file, now = Date.now()) => {
    const record = {
      fileName: file.name,
      blob: file.slice(0, file.size, ZIP_TYPE),
      size: file.size,
      lastModified: Number.isFinite(file.lastModified) ? file.lastModified : 0,
      savedAt: now,
    }
    if (!isPackRecord(record)) return Promise.reject(new PrivateStoreError(STORE_ERROR.FAILED))
    return run('readwrite', (store) => { store.put(record) })
  }

  return { isSupported, list, put }
}

// Zustand + Ablauf fuer die App. Alle Vorgaenge laufen nacheinander (restore und save ueberholen sich nie).
//   state.status: 'idle' | 'restoring' | 'ready' | 'unavailable' | 'error'
//   state.stored: gespeicherte Packs [{ fileName, size, savedAt }]
//   state.restored: Dateinamen, die beim Start aus dem Speicher wieder aktiviert wurden
//   state.problem: verstaendliche Meldung, falls Speichern/Wiederherstellen nicht moeglich war ('' = alles gut)
export function createAudioPackStorage({ store = createAudioPackStore(), requestPersistence = requestPersistentStorage } = {}) {
  const state = reactive({ status: 'idle', stored: [], restored: [], problem: '', persisted: null })
  let queue = Promise.resolve()
  const enqueue = (task) => {
    const run = queue.catch(() => {}).then(task)
    queue = run
    return run
  }

  const problemFor = (error) =>
    error instanceof PrivateStoreError && error.code === STORE_ERROR.QUOTA
      ? 'Auf diesem Gerät ist nicht genug Speicherplatz frei, um die Audio-Packs zu speichern. Die Audios funktionieren in dieser Sitzung trotzdem, müssen aber beim nächsten Öffnen erneut importiert werden.'
      : error instanceof PrivateStoreError && error.code === STORE_ERROR.UNAVAILABLE
        ? 'Dein Browser erlaubt hier kein lokales Speichern (zum Beispiel im privaten Modus). Die Audios funktionieren in dieser Sitzung trotzdem, müssen aber beim nächsten Öffnen erneut importiert werden.'
        : 'Die Audio-Packs konnten nicht lokal gespeichert werden. Die Audios funktionieren in dieser Sitzung trotzdem, müssen aber beim nächsten Öffnen erneut importiert werden.'

  const summarize = (records) => records.map(({ fileName, size, savedAt }) => ({ fileName, size, savedAt })).sort((a, b) => a.fileName.localeCompare(b.fileName))

  // `activate(file)` aktiviert ein gespeichertes ZIP ueber den normalen Importpfad und liefert true, wenn es aktiv wurde.
  // Ein ungueltiges gespeichertes ZIP wird gemeldet, aber nie geloescht.
  function restore(activate) {
    return enqueue(async () => {
      state.status = 'restoring'
      if (!store.isSupported()) {
        state.status = 'unavailable'
        return
      }
      try {
        const records = await store.list()
        state.stored = summarize(records)
        const restored = []
        const failed = []
        for (const record of records) {
          const file = new File([record.blob], record.fileName, { type: ZIP_TYPE, lastModified: record.lastModified })
          let active = false
          try {
            active = Boolean(await activate(file))
          } catch {
            active = false
          }
          if (active) restored.push(record.fileName)
          else failed.push(record.fileName)
        }
        state.restored = restored
        if (failed.length > 0) state.problem = `Gespeicherte Audio-Packs konnten nicht wiederhergestellt werden: ${failed.join(', ')}. Bitte importiere sie erneut.`
        state.status = 'ready'
      } catch (error) {
        state.status = error instanceof PrivateStoreError && error.code === STORE_ERROR.UNAVAILABLE ? 'unavailable' : 'error'
      }
    })
  }

  // Speichert die beim Import AKTIVIERTEN ZIPs. Ein bereits unveraendert gespeichertes ZIP wird nicht erneut geschrieben.
  function save(files) {
    if (!files || files.length === 0) return Promise.resolve()
    return enqueue(async () => {
      if (!store.isSupported()) {
        state.problem = problemFor(new PrivateStoreError(STORE_ERROR.UNAVAILABLE))
        return
      }
      let problem = ''
      let wrote = false
      let known = []
      try {
        known = await store.list()
      } catch {
        // Lesefehler: lieber erneut schreiben als nichts speichern
      }
      for (const file of files) {
        const same = known.find((record) => record.fileName === file.name && record.size === file.size && record.lastModified === (file.lastModified || 0))
        if (same) continue
        try {
          await store.put(file)
          wrote = true
        } catch (error) {
          problem = problemFor(error)
        }
      }
      try {
        state.stored = summarize(await store.list())
        if (state.status !== 'restoring') state.status = 'ready'
      } catch {
        // Anzeige bleibt wie sie ist
      }
      state.problem = problem
      if (wrote) state.persisted = await requestPersistence()
    })
  }

  return { state, restore, save }
}
