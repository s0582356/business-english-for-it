// Brueckenschicht zwischen dem Import (importLibraryFiles / importCoachFiles / ...) und dem lokalen Speicher
// (privateLibraryStore.js). Hier steht die Fachlogik, unabhaengig von Vue:
//
//   - collectAcceptedRecords: aus einem Importergebnis genau die Dateien herausziehen, die die bisherige Importlogik
//     tatsaechlich AKTIVIERT hat (geladen oder aktualisiert). Ungueltige, doppelte, aeltere oder im Konflikt stehende
//     Dateien erzeugen keinen Datensatz und koennen deshalb nie eine gespeicherte Bibliothek ueberschreiben.
//   - load: gespeicherte Datensaetze als File-Objekte bereitstellen, damit sie durch DENSELBEN Importpfad laufen
//     (erneute Validierung, gleiche Versions-/Konfliktregeln). Die Integritaet wird zusaetzlich per Fingerabdruck geprueft.
//   - save / remove: Schreiben nie zerstoerend; Fehler werden als Ergebnis gemeldet, nie als Absturz.
//
// Zusaetzlich fuehrt eine kleine Merkliste in localStorage (nur Schluessel, IDs, Version, Dateiname - nie Inhalte),
// welche Bibliotheken zuletzt gespeichert waren. So erkennt die App, wenn iOS oder der Browser den IndexedDB-Bestand
// entfernt hat, und fordert zum erneuten Import auf.
//
// Wichtig: Das ist eine DAUERHAFTE Speicherung ohne Ablauffrist. Es gibt bewusst keine automatische Loeschung nach
// 30 Tagen (anders als die reine Aktualisierungserinnerung der Cybersecurity-App, die nichts loescht).

import { fingerprintFile } from './fingerprint.js'
import {
  LIBRARY_KIND,
  PUT_OUTCOME,
  PrivateStoreError,
  REMOVE_OUTCOME,
  STORED_SCHEMA_VERSION,
  STORE_ERROR,
  createPrivateLibraryStore,
  requestPersistentStorage,
  summarizeRecord,
} from './privateLibraryStore.js'

export { summarizeRecord }

export const STORED_MARKER_KEY = 'businessEnglishStoredLibraries:v1'

export const KIND_LABELS = Object.freeze({
  [LIBRARY_KIND.QUIZ]: 'Quiz-Bibliothek',
  [LIBRARY_KIND.COACH]: 'Lerncoach',
  [LIBRARY_KIND.FIGURES]: 'Diagramm-Figuren',
  [LIBRARY_KIND.PRACTICE]: 'Übungen',
  [LIBRARY_KIND.SPEAKING]: 'Easy Speaking',
})

// Quiz-Bibliotheken liegen je Lernbereich (areaId) in einem Platz, Lerncoach/Figuren/Uebungen/Sprechuebungen je einmal -
// genau wie die Register der App (libraryByAreaId bzw. ein einzelner Eintrag).
export const storageKey = (kind, areaId) => (kind === LIBRARY_KIND.QUIZ ? `quiz:${areaId}` : kind)

export function recordToFile(record) {
  return new File([record.bytes], record.fileName, { type: 'application/json' })
}

// Die gewaehlte Datei, deren Inhalt der aktiven Bibliothek entspricht (Fingerabdruck; der Name kann bei einem
// Duplikat abweichen).
async function findSourceFile(files, entry) {
  for (const file of [...files]) {
    if ((await fingerprintFile(file)) === entry.fingerprint) return file
  }
  return null
}

async function buildRecord(kind, entry, files, now) {
  const source = await findSourceFile(files, entry)
  if (!source) return null
  const bytes = await source.arrayBuffer()
  const { library } = entry
  return {
    key: storageKey(kind, library.areaId),
    kind,
    areaId: library.areaId,
    areaTitle: kind === LIBRARY_KIND.QUIZ && typeof library.areaTitle === 'string' ? library.areaTitle : null,
    libraryId: library.libraryId,
    libraryVersion: library.libraryVersion,
    fileName: source.name,
    fingerprint: entry.fingerprint,
    size: bytes.byteLength,
    savedAt: now,
    schemaVersion: STORED_SCHEMA_VERSION,
    bytes,
  }
}

// Datensaetze fuer alles, was dieser Import neu aktiviert hat. `result` ist das Ergebnis des jeweiligen
// import*Files-Aufrufs, `files` die dabei uebergebenen Dateien.
export async function collectAcceptedRecords(kind, files, result, { now = Date.now() } = {}) {
  const report = result?.report
  if (!report) return []
  // Auch Duplikate der aktiven Bibliothek: fehlt sie im Speicher (z. B. vom Browser entfernt), wird sie so
  // beim erneuten Auswaehlen wieder abgelegt. Bereits unveraendert Gespeichertes filtert der Aufrufer heraus.
  const accepted = [...report.loaded, ...report.upgrades, ...report.duplicates]
  if (accepted.length === 0) return []

  const entries = []
  if (kind === LIBRARY_KIND.QUIZ) {
    for (const areaId of new Set(accepted.map((item) => item.areaId))) {
      const entry = result.libraryByAreaId?.[areaId]
      // Im Konflikt ist keine Bibliothek aktiv (Reihenfolge-Unabhaengigkeit): dann wird nichts gespeichert.
      if (entry && !result.conflictsByAreaId?.[areaId]) entries.push(entry)
    }
  } else if (result.entry && !result.conflict) {
    entries.push(result.entry)
  }

  const records = []
  for (const entry of entries) {
    const record = await buildRecord(kind, entry, files, now)
    if (record) records.push(record)
  }
  return records
}

function markerStorage(getStorage) {
  try {
    return getStorage() ?? null
  } catch {
    return null
  }
}

function readMarker(getStorage) {
  try {
    const raw = markerStorage(getStorage)?.getItem(STORED_MARKER_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.key === 'string') : []
  } catch {
    return []
  }
}

function writeMarker(getStorage, entries) {
  try {
    const storage = markerStorage(getStorage)
    if (!storage) return
    if (entries.length === 0) storage.removeItem(STORED_MARKER_KEY)
    else storage.setItem(STORED_MARKER_KEY, JSON.stringify(entries))
  } catch {
    // Merkliste ist nur ein Hinweisgeber; ohne sie funktioniert alles andere weiter.
  }
}

const markerEntry = (summary) => ({
  key: summary.key,
  kind: summary.kind ?? null,
  areaId: summary.areaId ?? null,
  libraryId: summary.libraryId ?? null,
  libraryVersion: summary.libraryVersion ?? null,
  fileName: summary.fileName ?? null,
})

export function createLibraryPersistence({
  store = createPrivateLibraryStore(),
  markerLocalStorage = () => globalThis.localStorage,
  requestPersistence = requestPersistentStorage,
} = {}) {
  const empty = { records: [], files: [], invalid: [], missing: [] }

  // Liest den tatsaechlichen Bestand aus dem Speicher. status: 'unavailable' (kein IndexedDB / gesperrt),
  // 'error' (anderer Fehler beim Lesen), 'ready'. `syncMarker` gleicht die Merkliste an (nur beim Start; bei der
  // Tab-Synchronisierung bleibt sie unberuehrt, damit sich zwei Instanzen nicht gegenseitig ueberschreiben).
  async function inspect({ syncMarker = false } = {}) {
    if (!store.isSupported()) return { status: 'unavailable', code: STORE_ERROR.UNAVAILABLE, ...empty }

    let listing
    try {
      listing = await store.list()
    } catch (error) {
      const code = error instanceof PrivateStoreError ? error.code : STORE_ERROR.FAILED
      return { status: code === STORE_ERROR.UNAVAILABLE ? 'unavailable' : 'error', code, ...empty }
    }

    const records = []
    const files = []
    const invalid = listing.corrupt.map(({ key, identity }) => ({ key, record: null, identity, reason: 'Der gespeicherte Eintrag ist beschädigt.' }))
    for (const record of listing.records) {
      const file = recordToFile(record)
      if ((await fingerprintFile(file)) !== record.fingerprint) {
        const summary = summarizeRecord(record)
        invalid.push({ key: record.key, record: summary, identity: summary.identity, reason: 'Die gespeicherten Daten sind beschädigt.' })
        continue
      }
      records.push(summarizeRecord(record))
      files.push(file)
    }

    const present = new Set([...records.map((entry) => entry.key), ...invalid.map((entry) => entry.key)])
    const previousMarker = readMarker(markerLocalStorage)
    const missing = previousMarker.filter((entry) => !present.has(entry.key))

    if (syncMarker) {
      // Merkliste an den tatsaechlichen Bestand angleichen (fehlende bleiben bis zum Ausblenden/Neuimport erhalten).
      const nextMarker = [
        ...records.map(markerEntry),
        ...invalid.map((entry) => markerEntry(entry.record ?? previousMarker.find((m) => m.key === entry.key) ?? { key: entry.key })),
        ...missing,
      ]
      if (JSON.stringify(nextMarker) !== JSON.stringify(previousMarker)) writeMarker(markerLocalStorage, nextMarker)
    }

    return { status: 'ready', code: null, records, files, invalid, missing }
  }

  const load = () => inspect({ syncMarker: true })

  // Speichert Datensaetze einzeln, jeder in EINER atomaren, versionssicheren Transaktion (siehe putIfNewer). Das
  // Ergebnis je Datensatz ist das TATSAECHLICHE: gespeichert, Duplikat, veraltet (anderswo steht eine hoehere Version),
  // Konflikt (gleiche Version bzw. andere Bibliothek mit anderem Inhalt) oder Fehler. Nichts wird bei veraltet,
  // Konflikt oder Fehler ueberschrieben; die anderen Datensaetze sind davon nicht betroffen.
  async function save(records) {
    const results = { saved: [], duplicates: [], stale: [], conflicts: [], failed: [], persisted: null }
    for (const record of records) {
      try {
        const { outcome, stored } = await store.putIfNewer(record)
        const incoming = summarizeRecord(record)
        const entry = { key: record.key, kind: record.kind, fileName: record.fileName, libraryVersion: record.libraryVersion, incoming, stored }
        if (outcome === PUT_OUTCOME.SAVED) results.saved.push(stored)
        else if (outcome === PUT_OUTCOME.DUPLICATE) results.duplicates.push(entry)
        else if (outcome === PUT_OUTCOME.STALE) results.stale.push(entry)
        else results.conflicts.push(entry)
        // Die Merkliste folgt dem, was wirklich gespeichert ist (nicht dem, was dieser Tab versucht hat).
        if (stored) {
          const marker = readMarker(markerLocalStorage).filter((candidate) => candidate.key !== record.key)
          writeMarker(markerLocalStorage, [...marker, markerEntry(stored)])
        }
      } catch (error) {
        const code = error instanceof PrivateStoreError ? error.code : STORE_ERROR.FAILED
        results.failed.push({ key: record.key, kind: record.kind, fileName: record.fileName, code, message: error?.message ?? '' })
      }
    }
    if (results.saved.length > 0) results.persisted = await requestPersistence()
    return results
  }

  // Aktueller Stand (Metadaten + Byte-Kopie) fuer die Loeschbestaetigung; null, wenn nicht (mehr) vorhanden.
  const prepareRemoval = (key) => store.readSnapshot(key)

  // Entfernt nur, wenn noch genau der bestaetigte Datensatz gespeichert ist (Metadaten UND Bytes, siehe Snapshot).
  // Ergebnis: 'removed' | 'gone' (schon weg) | 'changed' (inzwischen veraendert: NICHT entfernt). Fehler werden geworfen.
  async function remove(key, snapshot) {
    const { outcome, stored } = await store.removeIfUnchanged(key, snapshot)
    if (outcome === REMOVE_OUTCOME.REMOVED || outcome === REMOVE_OUTCOME.GONE) {
      writeMarker(markerLocalStorage, readMarker(markerLocalStorage).filter((entry) => entry.key !== key))
    } else if (stored) {
      const marker = readMarker(markerLocalStorage).filter((candidate) => candidate.key !== key)
      writeMarker(markerLocalStorage, [...marker, markerEntry(stored)])
    }
    return { outcome, stored }
  }

  // Blendet den Hinweis "vom Browser entfernt" aus (die Merkliste vergisst den Eintrag).
  function dismissMissing(key) {
    writeMarker(markerLocalStorage, readMarker(markerLocalStorage).filter((entry) => entry.key !== key))
  }

  return { isSupported: () => store.isSupported(), load, inspect, save, prepareRemoval, remove, dismissMissing }
}
