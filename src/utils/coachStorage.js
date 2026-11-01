// Lerncoach-Fortschritt - getrennt vom Quiz-Fortschritt (businessEnglishProgress:v2).
//
// Gespeichert werden ausschliesslich Metadaten: Schritt-IDs, Ergebnisse,
// Zeitstempel, Inhalts-Fingerabdruck (revision) und der Wiederholungstermin.
// Niemals Texte, Fragen, Antworten oder eigene Saetze.
//
// Keine stille Loeschung: Aendert sich ein Schritt in einer neuen Bibliotheks-
// version, bleibt der alte Eintrag erhalten und gilt nur als "veraltet" (stale);
// entfernte Schritte hinterlassen harmlose verwaiste Eintraege. Ist der
// gespeicherte Stand nicht lesbar oder hat eine fremde schemaVersion, wird die
// Rohfassung unter COACH_UNREADABLE_KEY gesichert, bevor neu begonnen wird.

export const COACH_STORAGE_KEY = 'businessEnglishCoach:v1'
export const COACH_UNREADABLE_KEY = 'businessEnglishCoach:v1:unreadable'

const SCHEMA_VERSION = 1
const STEP_STATUSES = ['seen', 'correct', 'incorrect', 'self-ok', 'self-almost', 'self-again']
// Diese Ergebnisse markieren einen Schritt als "schwierig" -> kommt in die Wiederholung.
const DIFFICULT_STATUSES = ['incorrect', 'self-almost', 'self-again']
export const REVIEW_INTERVAL_DAYS = [1, 3, 7]
const DAY_MS = 24 * 60 * 60 * 1000

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function storageAvailable() {
  return typeof window !== 'undefined' && !!window.localStorage
}

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, units: {} }
}

function sanitizeStep(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (!STEP_STATUSES.includes(entry.status)) return null
  if (!Number.isInteger(entry.attempts) || entry.attempts < 1) return null
  if (!isNonEmptyString(entry.revision) || !isIsoDate(entry.updatedAt)) return null
  return { status: entry.status, attempts: entry.attempts, revision: entry.revision, updatedAt: entry.updatedAt }
}

function sanitizeReview(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (!Number.isInteger(entry.box) || entry.box < 1 || entry.box > REVIEW_INTERVAL_DAYS.length) return null
  if (!isIsoDate(entry.dueAt) || !isIsoDate(entry.lastReviewedAt)) return null
  return { box: entry.box, dueAt: entry.dueAt, lastReviewedAt: entry.lastReviewedAt }
}

function sanitizeUnit(entry) {
  if (!entry || typeof entry !== 'object') return null
  const steps = {}
  for (const [stepId, stepEntry] of Object.entries(entry.steps ?? {})) {
    const safe = isNonEmptyString(stepId) ? sanitizeStep(stepEntry) : null
    if (safe) steps[stepId] = safe
  }
  return {
    currentStepId: isNonEmptyString(entry.currentStepId) ? entry.currentStepId : null,
    startedAt: isIsoDate(entry.startedAt) ? entry.startedAt : null,
    completedAt: isIsoDate(entry.completedAt) ? entry.completedAt : null,
    steps,
    review: sanitizeReview(entry.review),
  }
}

function emptyUnit() {
  return { currentStepId: null, startedAt: null, completedAt: null, steps: {}, review: null }
}

function quarantine(raw) {
  try {
    window.localStorage.setItem(COACH_UNREADABLE_KEY, raw)
  } catch {
    // Sicherung nicht moeglich - der Originalschluessel bleibt trotzdem unveraendert, bis neu geschrieben wird.
  }
}

function readStore() {
  if (!storageAvailable()) return emptyStore()
  let raw = null
  try {
    raw = window.localStorage.getItem(COACH_STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw)
    if (parsed?.schemaVersion !== SCHEMA_VERSION) {
      quarantine(raw)
      return emptyStore()
    }
    const units = {}
    for (const [unitId, entry] of Object.entries(parsed.units ?? {})) {
      const safe = isNonEmptyString(unitId) ? sanitizeUnit(entry) : null
      if (safe) units[unitId] = safe
    }
    return { schemaVersion: SCHEMA_VERSION, units }
  } catch {
    if (raw) quarantine(raw)
    return emptyStore()
  }
}

function writeStore(store) {
  if (!storageAvailable()) return false
  try {
    window.localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify(store))
    return true
  } catch {
    return false
  }
}

function mutateUnit(unitId, change) {
  if (!isNonEmptyString(unitId)) return false
  const store = readStore()
  const unit = store.units[unitId] ?? emptyUnit()
  change(unit)
  store.units[unitId] = unit
  return writeStore(store)
}

export function getCoachUnitState(unitId) {
  if (!isNonEmptyString(unitId)) return emptyUnit()
  return readStore().units[unitId] ?? emptyUnit()
}

// Merkt sich die Position (Resume) und den Beginn der Einheit.
export function saveCoachPosition(unitId, stepId, now = new Date()) {
  if (!isNonEmptyString(stepId)) return false
  return mutateUnit(unitId, (unit) => {
    unit.currentStepId = stepId
    unit.startedAt ??= now.toISOString()
  })
}

// status: 'seen' (Erklaerung/Beispiele gelesen), 'correct'/'incorrect' (Choice/Gap),
// 'self-ok'/'self-almost'/'self-again' (Selbsteinschaetzung bei eigener Satzbildung).
export function saveCoachStepResult(unitId, step, status, now = new Date()) {
  if (!STEP_STATUSES.includes(status) || !isNonEmptyString(step?.stepId) || !isNonEmptyString(step?.revision)) return false
  return mutateUnit(unitId, (unit) => {
    const previous = unit.steps[step.stepId]
    unit.steps[step.stepId] = {
      status,
      attempts: (previous?.attempts ?? 0) + 1,
      revision: step.revision,
      updatedAt: now.toISOString(),
    }
  })
}

// Schritte der aktuellen Bibliotheksversion, deren gespeichertes Ergebnis zu einem
// anderen Inhalt gehoert (veraltet) bzw. gar nicht vorhanden ist.
export function getUnitStepOverview(unit, state = getCoachUnitState(unit.unitId)) {
  const overview = { current: [], stale: [], difficult: [], open: [] }
  for (const step of unit.steps) {
    const saved = state.steps[step.stepId]
    if (!saved) overview.open.push(step.stepId)
    else if (saved.revision !== step.revision) overview.stale.push(step.stepId)
    else {
      overview.current.push(step.stepId)
      if (DIFFICULT_STATUSES.includes(saved.status)) overview.difficult.push(step.stepId)
    }
  }
  return overview
}

export function nextReviewState(previous, { hadTrouble }, now = new Date()) {
  const box = hadTrouble ? 1 : Math.min((previous?.box ?? 0) + 1, REVIEW_INTERVAL_DAYS.length)
  return {
    box,
    lastReviewedAt: now.toISOString(),
    dueAt: new Date(now.getTime() + REVIEW_INTERVAL_DAYS[box - 1] * DAY_MS).toISOString(),
  }
}

// Schliesst einen Durchgang (Lernen oder Wiederholen) ab und plant die naechste Wiederholung.
export function completeCoachUnit(unitId, { hadTrouble, mode = 'learn' }, now = new Date()) {
  return mutateUnit(unitId, (unit) => {
    unit.currentStepId = null
    if (mode === 'learn') unit.completedAt = now.toISOString()
    unit.review = nextReviewState(unit.review, { hadTrouble }, now)
  })
}

export function isReviewDue(state, now = new Date()) {
  return Boolean(state?.review) && Date.parse(state.review.dueAt) <= now.getTime()
}

// Neu beginnen: Position zuruecksetzen, Ergebnisse und Wiederholungstermin bleiben erhalten.
export function resetCoachPosition(unitId) {
  return mutateUnit(unitId, (unit) => { unit.currentStepId = null })
}
