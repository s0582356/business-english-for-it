// ID-basierte Fortschritts-Persistenz.
//
// Fortschritt wird ausschliesslich ueber stabile IDs (areaId + itemId)
// zugeordnet - NICHT ueber einen Datei-Fingerprint. Laedt Altan eine neue
// Bibliotheksversion, bleibt der Fortschritt bestehender itemIds automatisch
// erhalten (reiner ID-Lookup), neue itemIds gelten als offen, entfernte
// itemIds hinterlassen harmlose verwaiste Eintraege (kein Garbage Collector
// in V1). Ein Datei-Fingerprint wird hier bewusst nicht mehr verwendet -
// er bleibt Aufgabe von libraryImport.js (Duplikat-/Diagnosezwecke).
//
// Gespeichert werden ausschliesslich Metadaten (Status, Versuche, Zeitstempel,
// letzte Position) - niemals Fragen, Optionen, Erklaerungen, Steps oder
// vollstaendige Lernbibliotheken.

export const PROGRESS_STORAGE_KEY = 'businessEnglishProgress:v2'

const SCHEMA_VERSION = 1
const VALID_STATUSES = ['correct', 'incorrect']

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function storageAvailable() {
  return typeof window !== 'undefined' && !!window.localStorage
}

export function buildItemKey(areaId, itemId) {
  if (!isNonEmptyString(areaId) || !isNonEmptyString(itemId)) return null
  return `${areaId}::${itemId}`
}

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, itemStatus: {}, lastPosition: {} }
}

function sanitizeItemEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (!VALID_STATUSES.includes(entry.status)) return null
  if (!Number.isInteger(entry.attempts) || entry.attempts < 1) return null
  if (typeof entry.lastAnsweredAt !== 'string' || Number.isNaN(Date.parse(entry.lastAnsweredAt))) return null
  // Explizite Allowlist: kein beliebiges Fremdobjekt (z. B. privater Content) wird gespeichert.
  return { status: entry.status, attempts: entry.attempts, lastAnsweredAt: entry.lastAnsweredAt }
}

function sanitizePositionEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (!isNonEmptyString(entry.lessonId)) return null
  if (entry.scenarioId !== undefined && !isNonEmptyString(entry.scenarioId)) return null
  if (entry.itemId !== undefined && !isNonEmptyString(entry.itemId)) return null
  if (typeof entry.updatedAt !== 'string' || Number.isNaN(Date.parse(entry.updatedAt))) return null
  const safeEntry = { lessonId: entry.lessonId, updatedAt: entry.updatedAt }
  if (entry.scenarioId !== undefined) safeEntry.scenarioId = entry.scenarioId
  if (entry.itemId !== undefined) safeEntry.itemId = entry.itemId
  return safeEntry
}

function readStore() {
  if (!storageAvailable()) return emptyStore()
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw)
    if (parsed?.schemaVersion !== SCHEMA_VERSION) return emptyStore()

    const itemStatus = {}
    for (const [key, entry] of Object.entries(parsed.itemStatus ?? {})) {
      if (typeof key !== 'string' || !key.includes('::')) continue
      const safeEntry = sanitizeItemEntry(entry)
      if (safeEntry) itemStatus[key] = safeEntry
    }

    const lastPosition = {}
    for (const [areaId, entry] of Object.entries(parsed.lastPosition ?? {})) {
      if (!isNonEmptyString(areaId)) continue
      const safeEntry = sanitizePositionEntry(entry)
      if (safeEntry) lastPosition[areaId] = safeEntry
    }

    return { schemaVersion: SCHEMA_VERSION, itemStatus, lastPosition }
  } catch {
    return emptyStore()
  }
}

function writeStore(store) {
  if (!storageAvailable()) return false
  try {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(store))
    return true
  } catch {
    return false
  }
}

export function recordItemResult(areaId, itemId, correct) {
  const key = buildItemKey(areaId, itemId)
  if (!key) return false
  const store = readStore()
  const previous = store.itemStatus[key]
  store.itemStatus[key] = {
    status: correct ? 'correct' : 'incorrect',
    attempts: (previous?.attempts ?? 0) + 1,
    lastAnsweredAt: new Date().toISOString(),
  }
  return writeStore(store)
}

export function getItemStatus(areaId, itemId) {
  const key = buildItemKey(areaId, itemId)
  if (!key) return null
  return readStore().itemStatus[key] ?? null
}

// Liefert { itemId: entry } fuer genau einen Bereich - praktisch fuer
// spaetere "X von Y erledigt"-Anzeigen, ohne einen zweiten, separat zu
// pflegenden Aggregatwert speichern zu muessen.
export function getAreaItemStatuses(areaId) {
  if (!isNonEmptyString(areaId)) return {}
  const prefix = `${areaId}::`
  const result = {}
  for (const [key, entry] of Object.entries(readStore().itemStatus)) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = entry
  }
  return result
}

export function saveLastPosition(areaId, position) {
  if (!isNonEmptyString(areaId)) return false
  const safeEntry = sanitizePositionEntry({ ...position, updatedAt: new Date().toISOString() })
  if (!safeEntry) return false
  const store = readStore()
  store.lastPosition[areaId] = safeEntry
  return writeStore(store)
}

export function getLastPosition(areaId) {
  if (!isNonEmptyString(areaId)) return null
  return readStore().lastPosition[areaId] ?? null
}

// Prueft eine gespeicherte lastPosition gegen die aktuell geladene Library und
// loest sie auf ein gueltiges Navigationsziel auf. Faellt bei inzwischen
// entfernten Inhalten stufenweise zurueck (Item -> Szenario-Anfang ->
// Lektion), statt zu crashen oder Progressdaten zu veraendern. Gibt null
// zurueck, wenn selbst die Lektion nicht mehr existiert - der Aufrufer
// faellt dann auf den normalen Bereichseinstieg zurueck.
export function resolveResumeTarget(library, position) {
  if (!library || !Array.isArray(library.lessons) || !position) return null

  const lesson = library.lessons.find((candidate) => candidate.lessonId === position.lessonId)
  if (!lesson) return null

  const scenario = lesson.scenarios?.find((candidate) => candidate.scenarioId === position.scenarioId)
  if (!scenario) {
    return { lessonId: lesson.lessonId, lessonTitle: lesson.lessonTitle, scenarioId: null, scenarioTitle: null, itemId: null }
  }

  const itemExists = scenario.items.some((item) => item.id === position.itemId)
  return {
    lessonId: lesson.lessonId,
    lessonTitle: lesson.lessonTitle,
    scenarioId: scenario.scenarioId,
    scenarioTitle: scenario.scenarioTitle,
    itemId: itemExists ? position.itemId : null,
  }
}
