// Lokaler IndexedDB-Speicher fuer erfolgreich validierte private JSON-Bibliotheken (Auftrag 089).
//
// Gespeichert wird die ROHE Original-Datei (Bytes) samt kleinen Metadaten. Beim naechsten Start wird sie wie eine
// frisch gewaehlte Datei erneut validiert und mit der bisherigen Importlogik aktiviert; es gibt keinen zweiten,
// abweichenden Lesepfad. Die Daten verlassen das Geraet nie: kein fetch, kein Backend, keine externen Dienste.
//
// Nicht Gegenstand dieses Speichers: Audio-Dateien (.mp3) und Audio-Pakete (.zip). Der Speicher akzeptiert nur die
// vier JSON-Arten (QUIZ, COACH, FIGURES, PRACTICE).
//
// Atomar und versionssicher (Auftrag 091): Jede Schreibaktion ist genau EINE readwrite-Transaktion, in der der
// aktuell gespeicherte Datensatz gelesen, mit dem eingehenden verglichen und nur dann geschrieben bzw. geloescht wird.
// Zwischen Pruefung und Schreiben gibt es keine Luecke, in der ein anderer Tab (oder eine andere App-Instanz) einen
// neueren Stand ablegen koennte, und innerhalb der Transaktion wird nichts Externes abgewartet (nur Request-Callbacks).
//   putIfNewer(record)                     -> saved | duplicate | stale | conflict
//   readSnapshot(key)                      -> { identity, value }: Metadaten + VOLLSTAENDIGE tiefe Kopie des gespeicherten Werts
//   removeIfUnchanged(key, snapshot)       -> removed | gone | changed (kompletter Wert synchron verglichen, strictValue.js)
// Scheitert eine Transaktion (z. B. Speicherplatz voll), bleibt der bisherige Datensatz unveraendert erhalten.
// Fehlermeldungen enthalten nie Inhalte der Bibliotheken.

import { MAX_JSON_FILE_BYTES } from './importLimits.js'
import { sha256HexSync } from './sha256.js'
import { strictClone, strictEqual } from './strictValue.js'

export const PRIVATE_STORE_DB_NAME = 'businessEnglishPrivateLibraries'
export const PRIVATE_STORE_DB_VERSION = 1
export const STORED_SCHEMA_VERSION = 1

const OBJECT_STORE = 'libraries'
const DEFAULT_OPEN_TIMEOUT_MS = 8000

export const LIBRARY_KIND = Object.freeze({ QUIZ: 'quiz', COACH: 'coach', FIGURES: 'figures', PRACTICE: 'practice' })
const KINDS = Object.values(LIBRARY_KIND)

export const STORE_ERROR = Object.freeze({ UNAVAILABLE: 'unavailable', QUOTA: 'quota', BLOCKED: 'blocked', FAILED: 'failed' })

const ERROR_MESSAGES = {
  [STORE_ERROR.UNAVAILABLE]: 'Lokales Speichern ist in diesem Browser nicht verfügbar.',
  [STORE_ERROR.QUOTA]: 'Der Speicherplatz auf diesem Gerät reicht nicht aus.',
  [STORE_ERROR.BLOCKED]: 'Der lokale Speicher ist durch einen anderen geöffneten Tab der App blockiert.',
  [STORE_ERROR.FAILED]: 'Der lokale Speicher meldete einen Fehler.',
}

export class PrivateStoreError extends Error {
  constructor(code, cause) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES[STORE_ERROR.FAILED])
    this.name = 'PrivateStoreError'
    this.code = code
    // Nur der technische Fehlername, nie die Nachricht des Browsers (kann Pfade/Inhalte enthalten).
    this.causeName = cause?.name ?? null
  }
}

function mapError(error) {
  if (error instanceof PrivateStoreError) return error
  const name = error?.name
  if (name === 'QuotaExceededError' || error?.code === 22) return new PrivateStoreError(STORE_ERROR.QUOTA, error)
  // Safari im privaten Modus bzw. gesperrte Website-Daten melden SecurityError / InvalidStateError beim Oeffnen.
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotAllowedError') {
    return new PrivateStoreError(STORE_ERROR.UNAVAILABLE, error)
  }
  return new PrivateStoreError(STORE_ERROR.FAILED, error)
}

const isBinary = (value) => Object.prototype.toString.call(value) === '[object ArrayBuffer]'
const isText = (value) => typeof value === 'string' && value !== ''

const primitive = (value) => (typeof value === 'string' || Number.isFinite(value) ? value : null)

// Identitaet des konkret gespeicherten Datensatzes (nur Metadaten, keine Inhalte). Funktioniert auch fuer
// beschaedigte Eintraege, deren Felder unzuverlaessig sind: verglichen wird, was tatsaechlich im Speicher steht.
// Ein von einem anderen Tab neu geschriebener Datensatz hat ein anderes savedAt (und meist andere Groesse/Version).
export function identityOf(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    savedAt: primitive(source.savedAt),
    size: primitive(source.size),
    fingerprint: primitive(source.fingerprint),
    libraryVersion: primitive(source.libraryVersion),
    byteLength: isBinary(source.bytes) ? source.bytes.byteLength : null,
    key: primitive(source.key),
    kind: primitive(source.kind),
    libraryId: primitive(source.libraryId),
    fileName: primitive(source.fileName),
  }
}

const IDENTITY_FIELDS = Object.keys(identityOf({}))

// Snapshot des tatsaechlich gespeicherten Datensatzes: `identity` (Metadaten fuer Anzeige/Abgleich) und `value`, eine
// vollstaendige, unabhaengige Kopie des KOMPLETTEN gespeicherten Werts (alle eigenen Felder, Typen, Bytes). Wirft
// UnsupportedValueError, wenn der Wert nicht sicher kopierbar/vergleichbar ist.
export function snapshotOf(value) {
  return { identity: identityOf(value), value: strictClone(value) }
}

// Vollstaendiger, synchroner Vergleich des aktuell gespeicherten Werts mit dem Snapshot (siehe strictValue.js).
// Kein Hash, kein await: laeuft innerhalb der readwrite-Transaktion. Nicht vergleichbare Werte werfen.
export function sameSnapshot(stored, expected) {
  if (!expected || typeof expected !== 'object' || !('value' in expected)) return false
  return strictEqual(stored, expected.value)
}

// Gleiche Metadaten-Identitaet (ohne Inhalt) zweier Werte/Snapshots, z. B. angezeigter Stand gegen frisch gelesenen.
export function identitiesMatch(a, b) {
  const left = a?.identity ?? identityOf(a)
  const right = b?.identity ?? identityOf(b)
  return IDENTITY_FIELDS.every((field) => left[field] === right[field])
}

// Datensatz ohne die Rohdaten (fuer Anzeige, Merkliste und Ergebnismeldungen).
export function summarizeRecord(record) {
  return {
    key: record.key,
    kind: record.kind,
    areaId: record.areaId ?? null,
    areaTitle: record.areaTitle ?? null,
    libraryId: record.libraryId ?? null,
    libraryVersion: record.libraryVersion ?? null,
    fileName: record.fileName,
    fingerprint: record.fingerprint,
    size: record.size,
    savedAt: record.savedAt,
    identity: identityOf(record),
  }
}

export const PUT_OUTCOME = Object.freeze({ SAVED: 'saved', DUPLICATE: 'duplicate', STALE: 'stale', CONFLICT: 'conflict' })
export const REMOVE_OUTCOME = Object.freeze({ REMOVED: 'removed', GONE: 'gone', CHANGED: 'changed' })

// Entscheidung fuer EINEN Schluessel, gemaess den bestehenden Versionsregeln (classifyIncomingLibrary):
// gleiche Bibliotheks-ID -> hoehere Version ersetzt, niedrigere ist veraltet, gleiche Version mit gleichem
// Fingerabdruck ist ein Duplikat, mit anderem Fingerabdruck ein Konflikt; andere Bibliotheks-ID -> Konflikt.
// Ein beschaedigter vorhandener Eintrag darf durch eine gueltige Bibliothek repariert werden.
function decidePut(existing, incoming) {
  if (existing === undefined || !isStoredRecord(existing)) return PUT_OUTCOME.SAVED
  if (existing.libraryId !== incoming.libraryId) return PUT_OUTCOME.CONFLICT
  if (!Number.isFinite(existing.libraryVersion) || !Number.isFinite(incoming.libraryVersion)) return PUT_OUTCOME.CONFLICT
  if (incoming.libraryVersion > existing.libraryVersion) return PUT_OUTCOME.SAVED
  if (incoming.libraryVersion < existing.libraryVersion) return PUT_OUTCOME.STALE
  return existing.fingerprint === incoming.fingerprint ? PUT_OUTCOME.DUPLICATE : PUT_OUTCOME.CONFLICT
}

function isIntact(record) {
  try {
    return sha256HexSync(new Uint8Array(record.bytes)) === record.fingerprint
  } catch {
    return false
  }
}

// Form eines gueltigen Datensatzes. Prueft nur die Huelle; der Inhalt wird beim Wiederherstellen vom normalen
// Import validiert.
export function isStoredRecord(record) {
  return (
    Boolean(record) &&
    typeof record === 'object' &&
    record.schemaVersion === STORED_SCHEMA_VERSION &&
    isText(record.key) &&
    KINDS.includes(record.kind) &&
    isText(record.fileName) &&
    isText(record.fingerprint) &&
    isBinary(record.bytes) &&
    record.bytes.byteLength > 0 &&
    record.size === record.bytes.byteLength &&
    Number.isFinite(record.savedAt)
  )
}

function assertWritable(record) {
  if (!isStoredRecord(record)) throw new PrivateStoreError(STORE_ERROR.FAILED)
  // Eigene Obergrenze wie beim Import: nichts speichern, was der Import ohnehin abgelehnt haette.
  if (record.size > MAX_JSON_FILE_BYTES) throw new PrivateStoreError(STORE_ERROR.QUOTA)
}

export function createPrivateLibraryStore({ indexedDB: factoryOverride, dbName = PRIVATE_STORE_DB_NAME, openTimeoutMs = DEFAULT_OPEN_TIMEOUT_MS } = {}) {
  let connection = null

  const factory = () => factoryOverride ?? globalThis.indexedDB

  function isSupported() {
    return Boolean(factory())
  }

  function openDatabase() {
    if (connection) return connection
    const idb = factory()
    if (!idb) return Promise.reject(new PrivateStoreError(STORE_ERROR.UNAVAILABLE))

    const attempt = new Promise((resolve, reject) => {
      let settled = false
      const fail = (error) => {
        if (settled) return
        settled = true
        reject(mapError(error))
      }
      // Manche iOS-Versionen lassen indexedDB.open beim Kaltstart haengen: kontrolliert melden statt ewig warten.
      const timer = setTimeout(() => fail(new PrivateStoreError(STORE_ERROR.UNAVAILABLE)), openTimeoutMs)
      let request
      try {
        request = idb.open(dbName, PRIVATE_STORE_DB_VERSION)
      } catch (error) {
        clearTimeout(timer)
        fail(error)
        return
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
          request.result.createObjectStore(OBJECT_STORE, { keyPath: 'key' })
        }
      }
      request.onblocked = () => {
        clearTimeout(timer)
        fail(new PrivateStoreError(STORE_ERROR.BLOCKED))
      }
      request.onerror = () => {
        clearTimeout(timer)
        fail(request.error)
      }
      request.onsuccess = () => {
        clearTimeout(timer)
        const opened = request.result
        if (settled) {
          opened.close()
          return
        }
        settled = true
        // Der Browser darf die Verbindung jederzeit schliessen (Speicherdruck, Upgrade in anderem Tab): neu oeffnen.
        const forget = () => {
          if (connection === attemptRef) connection = null
        }
        opened.onversionchange = () => {
          opened.close()
          forget()
        }
        opened.onclose = forget
        resolve(opened)
      }
    })
    const attemptRef = attempt
    connection = attempt
    attempt.catch(() => {
      if (connection === attemptRef) connection = null
    })
    return attempt
  }

  // Eine zuvor geoeffnete Verbindung kann inzwischen geschlossen sein (InvalidStateError): einmal neu oeffnen.
  async function withDatabase(run) {
    for (let attempt = 0; ; attempt += 1) {
      const db = await openDatabase()
      try {
        return await run(db)
      } catch (error) {
        if (attempt === 0 && error?.name === 'InvalidStateError') {
          connection = null
          continue
        }
        throw mapError(error)
      }
    }
  }

  // Eine Transaktion, rein callback-basiert: `work(store, setResult, abortWith)` laeuft synchron bzw. in Request-Callbacks
  // derselben Transaktion; es wird nichts Externes (Netz, Timer, Promises anderer Quellen) abgewartet, damit die
  // Transaktion nie unbeabsichtigt inaktiv wird. Das Ergebnis gilt erst, wenn die Transaktion abgeschlossen ist.
  function atomic(mode, work) {
    return withDatabase(
      (db) =>
        new Promise((resolve, reject) => {
          let transaction
          try {
            transaction = db.transaction(OBJECT_STORE, mode)
          } catch (error) {
            reject(error)
            return
          }
          let result
          let failure = null
          const abortWith = (error) => {
            failure = error
            try {
              transaction.abort()
            } catch {
              // bereits beendet
            }
          }
          transaction.oncomplete = () => resolve(result)
          transaction.onerror = () => reject(failure ?? transaction.error)
          transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Transaktion abgebrochen.'))
          try {
            work(transaction.objectStore(OBJECT_STORE), (value) => { result = value }, abortWith)
          } catch (error) {
            abortWith(error)
          }
        }),
    )
  }

  // Alle Datensaetze. Strukturell ungueltige werden getrennt gemeldet (Schluessel und Identitaet bekannt, Inhalt nie
  // ausgegeben) und NICHT geloescht: eine neuere App-Version kann sie womoeglich lesen.
  async function list() {
    return atomic('readonly', (store, setResult, abortWith) => {
      const records = []
      const corrupt = []
      const request = store.openCursor()
      request.onerror = () => abortWith(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          setResult({ records, corrupt })
          return
        }
        if (isStoredRecord(cursor.value)) records.push(cursor.value)
        else corrupt.push({ key: String(cursor.key), identity: identityOf(cursor.value) })
        cursor.continue()
      }
    })
  }

  // Versionssicheres Speichern: Lesen, Vergleichen und (bedingtes) Schreiben in EINER readwrite-Transaktion.
  // Meldet das tatsaechliche Ergebnis samt dem danach gespeicherten Stand (`stored`).
  async function putIfNewer(record) {
    assertWritable(record)
    return atomic('readwrite', (store, setResult, abortWith) => {
      const read = store.get(record.key)
      read.onerror = () => abortWith(read.error)
      read.onsuccess = () => {
        try {
          const existing = read.result
          let outcome = decidePut(existing, record)
          // Ein vorhandener Datensatz, dessen Bytes nicht mehr zu seinem Fingerabdruck passen, ist unbrauchbar und darf
          // durch eine gueltige Bibliothek repariert werden (synchrone Pruefung, haelt die Transaktion nicht auf).
          if (outcome !== PUT_OUTCOME.SAVED && !isIntact(existing)) outcome = PUT_OUTCOME.SAVED
          if (outcome === PUT_OUTCOME.SAVED) store.put(record)
          const current = outcome === PUT_OUTCOME.SAVED ? record : existing
          setResult({ outcome, stored: isStoredRecord(current) ? summarizeRecord(current) : null })
        } catch (error) {
          abortWith(error)
        }
      }
    })
  }

  // Liest den Datensatz so, wie er jetzt gespeichert ist (Metadaten + Byte-Kopie), fuer die Loeschbestaetigung.
  // null, wenn es ihn nicht gibt.
  async function readSnapshot(key) {
    if (!isText(key)) throw new PrivateStoreError(STORE_ERROR.FAILED)
    return atomic('readonly', (store, setResult, abortWith) => {
      const read = store.get(key)
      read.onerror = () => abortWith(read.error)
      read.onsuccess = () => {
        try {
          setResult(read.result === undefined ? null : snapshotOf(read.result))
        } catch (error) {
          abortWith(error) // nicht sicher kopierbar: keine Rueckfrage, nichts wird veraendert
        }
      }
    })
  }

  // Entfernt den Datensatz nur, wenn dort noch genau der bestaetigte steht: Metadaten UND tatsaechliche Bytes werden in
  // derselben readwrite-Transaktion synchron verglichen. Hat ein anderer Tab ihn ersetzt oder haben sich die Bytes
  // veraendert, bleibt er erhalten (`changed`); ist er schon weg, ist das Ergebnis `gone`.
  async function removeIfUnchanged(key, expectedSnapshot) {
    if (!isText(key) || !expectedSnapshot || typeof expectedSnapshot !== 'object') throw new PrivateStoreError(STORE_ERROR.FAILED)
    return atomic('readwrite', (store, setResult, abortWith) => {
      const read = store.get(key)
      read.onerror = () => abortWith(read.error)
      read.onsuccess = () => {
        try {
          const existing = read.result
          if (existing === undefined) {
            setResult({ outcome: REMOVE_OUTCOME.GONE, stored: null })
          } else if (sameSnapshot(existing, expectedSnapshot)) {
            store.delete(key)
            setResult({ outcome: REMOVE_OUTCOME.REMOVED, stored: null })
          } else {
            setResult({ outcome: REMOVE_OUTCOME.CHANGED, stored: isStoredRecord(existing) ? summarizeRecord(existing) : null })
          }
        } catch (error) {
          abortWith(error)
        }
      }
    })
  }

  // Unbedingtes Schreiben ohne Versionspruefung: NUR fuer Tests und gezielte Reparatur, nie im normalen App-Pfad.
  async function forcePut(record) {
    assertWritable(record)
    await atomic('readwrite', (store) => { store.put(record) })
  }

  function close() {
    const current = connection
    connection = null
    current?.then((db) => db.close()).catch(() => {})
  }

  return { isSupported, list, putIfNewer, readSnapshot, removeIfUnchanged, forcePut, close }
}

// Geschaetzter Speicher (Nutzung/Kontingent) oder null, wenn der Browser keine Schaetzung liefert.
export async function estimateStorage(storage = globalThis.navigator?.storage) {
  try {
    if (!storage || typeof storage.estimate !== 'function') return null
    const { usage, quota } = await storage.estimate()
    return Number.isFinite(usage) && Number.isFinite(quota) ? { usage, quota } : null
  } catch {
    return null
  }
}

// Bittet den Browser, die lokalen Daten nicht automatisch zu bereinigen (best effort, folgenlos bei Ablehnung).
// true = zugesagt, false = nicht zugesagt, null = nicht unterstuetzt/unbekannt.
export async function requestPersistentStorage(storage = globalThis.navigator?.storage) {
  try {
    if (!storage || typeof storage.persist !== 'function') return null
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return true
    return Boolean(await storage.persist())
  } catch {
    return null
  }
}
