// Lerncoach-Fortschritt - getrennt vom Quiz-Fortschritt (businessEnglishProgress:v2).
//
// Gespeichert werden ausschliesslich Metadaten: Schritt-IDs, Ergebnisse,
// Zeitstempel, Inhalts-Fingerabdruck (revision) und der Wiederholungstermin.
// Niemals Texte, Fragen, Antworten oder eigene Saetze. Auch die Felder fuer das gefuehrte
// Schreibtraining (produce) bestehen nur aus festen Werten: Ergebnis-Stufen, Fehlercodes aus
// einer Allowlist, Wahrheitswerte und Zaehler. Jeder Wert wird beim Schreiben UND beim Lesen
// gegen diese Allowlists geprueft; nichts anderes kann persistiert werden.
//
// Keine stille Loeschung: Aendert sich ein Schritt in einer neuen Bibliotheks-
// version, bleibt der alte Eintrag erhalten und gilt nur als "veraltet" (stale);
// entfernte Schritte hinterlassen harmlose verwaiste Eintraege. Ist der
// gespeicherte Stand nicht lesbar oder hat eine fremde schemaVersion, wird die
// Rohfassung unter COACH_UNREADABLE_KEY gesichert, bevor neu begonnen wird.

import { ERROR_TAGS, OUTCOMES } from './coachSentenceCheck.js'

export const COACH_STORAGE_KEY = 'businessEnglishCoach:v1'
export const COACH_UNREADABLE_KEY = 'businessEnglishCoach:v1:unreadable'

const SCHEMA_VERSION = 1
const STEP_STATUSES = ['seen', 'correct', 'incorrect', 'self-ok', 'self-almost', 'self-again', 'gave-up']
const SELF_STATUSES = ['self-ok', 'self-almost', 'self-again']
// Diese Ergebnisse markieren einen Schritt als "schwierig" -> kommt in die Wiederholung.
// 'gave-up' = Loesung bewusst direkt angezeigt (zaehlt nie als geloest).
const DIFFICULT_STATUSES = ['incorrect', 'self-almost', 'self-again', 'gave-up']
// Herkunft eines Ergebnisses: auto = Auswahl/Luecke automatisch geprueft, structure = lokaler Strukturcheck,
// self = nur eigene Einschaetzung. Nur auto/structure zaehlen als objektive Ergebnisse.
const RUN_SOURCES = ['auto', 'structure', 'self']
export const RUN_LIMIT = 10
// Erfolgstage (okDays) sind kompakte Metadaten und bleiben auch bestehen, wenn die detaillierten Versuche (runs)
// auf RUN_LIMIT gekuerzt werden. Gespeichert werden nur Kalendertage ("2026-11-03") der Erfolge, gebunden an
// Inhaltsversion (rev) und Quelle (auto/structure) - nie Texte. Fuer "mehrere Tage" genuegen die letzten Tage.
export const DAY_LIMIT = 10
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/
// Plausible Untergrenze fuer Erfolgstage: die App gab es vor 2000 nicht. Eine Obergrenze (Zukunft) gibt es bewusst nicht -
// eine falsch gestellte Geraeteuhr soll bestehende Lernstaende nicht nachtraeglich entwerten.
const MIN_DAY_YEAR = 2000
const MAX_TAGS = 8
export const REVIEW_INTERVAL_DAYS = [1, 3, 7]

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

// Echter Kalendertag: Jahr, Monat und Tag werden in ein Datum umgewandelt und gegen die Eingabe geprueft
// (Date.parse allein rollt "2026-02-30" stillschweigend auf den 2. Maerz). Schaltjahre inklusive.
export function isValidDayKey(value) {
  if (typeof value !== 'string') return false
  const match = DAY_KEY.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (year < MIN_DAY_YEAR) return false
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

// Zeitstempel: ISO-Format mit echtem Kalendertag (kein stilles Weiterrollen unmoeglicher Daten).
function isIsoDate(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return false
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return false
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

// Lokaler Kalendertag ("2026-11-03") und lokaler Tagesbeginn: Intervalle zaehlen in Kalendertagen der
// lokalen Zeitzone, nicht in festen 24-Stunden-Bloecken (Sommer-/Winterzeitwechsel verschiebt sonst die Uhrzeit).
export function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function localDayStart(date, offsetDays = 0) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays, 0, 0, 0, 0)
}

function storageAvailable() {
  return typeof window !== 'undefined' && !!window.localStorage
}

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, units: {} }
}

function sanitizeRuns(list) {
  if (!Array.isArray(list)) return null
  const runs = []
  for (const run of list) {
    if (!run || typeof run !== 'object') continue
    if (!isIsoDate(run.at) || !isNonEmptyString(run.rev) || run.rev.length > 40) continue
    if (!RUN_SOURCES.includes(run.src) || typeof run.ok !== 'boolean') continue
    runs.push({ at: run.at, rev: run.rev, src: run.src, ok: run.ok })
  }
  return runs.slice(-RUN_LIMIT)
}

function sanitizeOkDays(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (!isNonEmptyString(entry.rev) || entry.rev.length > 40 || (entry.src !== 'auto' && entry.src !== 'structure')) return null
  if (!Array.isArray(entry.days)) return null
  const days = [...new Set(entry.days.filter(isValidDayKey))].sort().slice(-DAY_LIMIT)
  return days.length > 0 ? { rev: entry.rev, src: entry.src, days } : null
}

// Feste Struktur, keine freien Texte: nur Enum-Werte, Fehlercodes aus der Allowlist, Wahrheitswerte, Zaehler.
export function sanitizeProduce(entry) {
  if (!entry || typeof entry !== 'object') return null
  const outcome = (value) => (OUTCOMES.includes(value) ? value : null)
  const tries = Number.isInteger(entry.tries) && entry.tries >= 0 && entry.tries <= 2 ? entry.tries : 0
  const tags = Array.isArray(entry.tags) ? [...new Set(entry.tags.filter((tag) => ERROR_TAGS.includes(tag)))].slice(0, MAX_TAGS) : []
  return {
    checked: entry.checked === true,
    tries,
    first: outcome(entry.first),
    final: outcome(entry.final),
    tags,
    improved: entry.improved === true,
    gaveUp: entry.gaveUp === true,
    copied: entry.copied === true,
    self: SELF_STATUSES.includes(entry.self) ? entry.self : null,
  }
}

function sanitizeStep(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (!STEP_STATUSES.includes(entry.status)) return null
  if (!Number.isInteger(entry.attempts) || entry.attempts < 1) return null
  if (!isNonEmptyString(entry.revision) || !isIsoDate(entry.updatedAt)) return null
  const safe = { status: entry.status, attempts: entry.attempts, revision: entry.revision, updatedAt: entry.updatedAt }
  const runs = sanitizeRuns(entry.runs)
  if (runs && runs.length > 0) safe.runs = runs
  const okDays = sanitizeOkDays(entry.okDays)
  if (okDays) safe.okDays = okDays
  const produce = sanitizeProduce(entry.produce)
  if (produce) safe.produce = produce
  return safe
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

// Das objektive Ergebnis eines Durchgangs (fuer Verlauf und Erfolgstage): aus dem Status und, bei
// Freitext mit Strukturcheck, aus dem Ergebnis des Strukturchecks - nie aus der Selbsteinschaetzung allein.
function runFor(status, produce, revision, now) {
  if (status === 'seen') return null
  if (produce?.checked) {
    const ok = produce.final === 'met' && !produce.copied && !produce.gaveUp
    return { at: now.toISOString(), rev: revision, src: 'structure', ok }
  }
  if (status === 'correct' || status === 'incorrect') return { at: now.toISOString(), rev: revision, src: 'auto', ok: status === 'correct' }
  return { at: now.toISOString(), rev: revision, src: 'self', ok: status === 'self-ok' }
}

// status: 'seen' (Erklaerung/Beispiele gelesen), 'correct'/'incorrect' (Choice/Gap),
// 'self-ok'/'self-almost'/'self-again' (Selbsteinschaetzung bei eigener Satzbildung),
// 'gave-up' (Loesung bewusst direkt angezeigt).
// details.produce (optional): Metadaten des gefuehrten Schreibtrainings, siehe sanitizeProduce.
export function saveCoachStepResult(unitId, step, status, now = new Date(), details = {}) {
  if (!STEP_STATUSES.includes(status) || !isNonEmptyString(step?.stepId) || !isNonEmptyString(step?.revision)) return false
  const produce = sanitizeProduce(details?.produce)
  return mutateUnit(unitId, (unit) => {
    const previous = unit.steps[step.stepId]
    const entry = {
      status,
      attempts: (previous?.attempts ?? 0) + 1,
      revision: step.revision,
      updatedAt: now.toISOString(),
    }
    const run = runFor(status, produce, step.revision, now)
    const runs = [...(previous?.runs ?? []), ...(run ? [run] : [])].slice(-RUN_LIMIT)
    if (runs.length > 0) entry.runs = runs
    // Erfolgstage bleiben nur fuer die aktuelle Inhaltsversion erhalten; eine neue Revision beginnt neu.
    let okDays = previous?.okDays?.rev === step.revision ? previous.okDays : null
    // Aelterer Eintrag ohne Verlaufsdaten (Version 1): sein letzter Treffer wird beim ersten neuen Schreiben als
    // ein Erfolgstag uebernommen, damit er nicht verloren geht.
    if (!okDays && previous && !previous.runs && previous.revision === step.revision && previous.status === 'correct') {
      okDays = { rev: step.revision, src: 'auto', days: [localDayKey(new Date(previous.updatedAt))] }
    }
    if (run?.ok && (run.src === 'auto' || run.src === 'structure')) {
      const known = okDays?.src === run.src ? okDays.days : []
      okDays = { rev: step.revision, src: run.src, days: [...new Set([...known, localDayKey(now)])].sort().slice(-DAY_LIMIT) }
    }
    if (okDays) entry.okDays = okDays
    if (produce) entry.produce = produce
    unit.steps[step.stepId] = entry
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
      // Ein Freitext bleibt zur erneuten Uebung vorgemerkt ("schwierig"), solange der Strukturcheck am Ende einen
      // sicheren Fehler fand (issues) oder den Satz nicht bestaetigen konnte (unclear) - egal wie die
      // Selbsteinschaetzung ausfiel. Beides zaehlt NICHT als objektiver Erfolg.
      if (DIFFICULT_STATUSES.includes(saved.status) || saved.produce?.final === 'issues' || saved.produce?.final === 'unclear') overview.difficult.push(step.stepId)
    }
  }
  return overview
}

// Wiederholungsplan (1 / 3 / 7 lokale Kalendertage; Faelligkeit = Beginn dieses Tages, 00:00 Ortszeit).
//   hadTrouble  - Rueckfall auf Stufe 1, morgen wieder.
//   objective   - gab es in diesem Durchgang mindestens einen objektiven ERFOLG (automatisch richtig oder
//                 Struktur erfuellt)? Selbsteinschaetzung und "unklar" zaehlen nicht: ohne objektiven Erfolg
//                 steigt die Stufe nicht.
//   uncertain   - bleibt in der Einheit eine Aufgabe offen, die nicht zuverlaessig geprueft werden konnte (unclear)?
//                 Dann bleibt der bestehende Plan UNVERAENDERT (Stufe und Termin): weder steigt die Stufe, noch wird der
//                 Termin wegen der uebrigen richtigen Aufgaben weiter hinausgeschoben. Ein Rueckfall (hadTrouble) gewinnt.
//   Wiederholtes Ueben vor der Faelligkeit (z. B. mehrere Durchlaeufe am selben Tag) aendert den bestehenden
//   Plan nicht (ausser bei Schwierigkeiten): die Stufe steigt hoechstens einmal je faelligem Termin.
//   Bereits gespeicherte dueAt-Werte (aelteres Format, feste 24-Stunden-Schritte) werden unveraendert weiter beachtet.
export function nextReviewState(previous, { hadTrouble, objective = true, uncertain = false }, now = new Date()) {
  const schedule = (box) => ({
    box,
    lastReviewedAt: now.toISOString(),
    dueAt: localDayStart(now, REVIEW_INTERVAL_DAYS[box - 1]).toISOString(),
  })
  if (hadTrouble || !previous) return schedule(1)
  if (uncertain) return previous
  if (Date.parse(previous.dueAt) > now.getTime()) return previous
  return schedule(objective ? Math.min(previous.box + 1, REVIEW_INTERVAL_DAYS.length) : previous.box)
}

// Schliesst einen Durchgang (Lernen oder Wiederholen) ab und plant die naechste Wiederholung.
export function completeCoachUnit(unitId, { hadTrouble, mode = 'learn', objective = true, uncertain = false }, now = new Date()) {
  return mutateUnit(unitId, (unit) => {
    unit.currentStepId = null
    if (mode === 'learn') unit.completedAt = now.toISOString()
    unit.review = nextReviewState(unit.review, { hadTrouble, objective, uncertain }, now)
  })
}

export function isReviewDue(state, now = new Date()) {
  return Boolean(state?.review) && Date.parse(state.review.dueAt) <= now.getTime()
}

// Neu beginnen: Position zuruecksetzen, Ergebnisse und Wiederholungstermin bleiben erhalten.
export function resetCoachPosition(unitId) {
  return mutateUnit(unitId, (unit) => { unit.currentStepId = null })
}
