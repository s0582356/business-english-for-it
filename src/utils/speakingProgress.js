// Lernstatus der Sprechuebungen ("beherrscht" / "noch ueben"), nur lokal im Browser (localStorage).
//
// Zugeordnet wird ueber libraryId + Uebungs-ID, nie ueber den Dateifingerabdruck: Eine neue Version derselben
// Bibliothek behaelt den Status bestehender Uebungen. Gespeichert werden ausschliesslich IDs und der Status -
// niemals Aufgaben- oder Antworttexte. Ist localStorage nicht verfuegbar, arbeitet die App ohne Speicherung weiter.

export const SPEAKING_PROGRESS_KEY = 'businessEnglishSpeakingProgress:v1'
export const SPEAKING_STATUS = Object.freeze({ MASTERED: 'mastered', PRACTICE: 'practice' })

const SCHEMA_VERSION = 1
const VALID_STATUSES = Object.values(SPEAKING_STATUS)

function readAll() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SPEAKING_PROGRESS_KEY) ?? 'null')
    if (parsed?.schemaVersion === SCHEMA_VERSION && parsed.libraries && typeof parsed.libraries === 'object') return parsed.libraries
  } catch {
    // Fehlender oder beschaedigter Speicher: wie "noch nichts markiert".
  }
  return {}
}

// { [uebungsId]: 'mastered' | 'practice' } fuer eine Bibliothek (nur gueltige Eintraege).
export function loadSpeakingProgress(libraryId) {
  const stored = readAll()[libraryId]
  const progress = {}
  if (stored && typeof stored === 'object') {
    for (const [exerciseId, status] of Object.entries(stored)) {
      if (VALID_STATUSES.includes(status)) progress[exerciseId] = status
    }
  }
  return progress
}

// Neuer Stand einer Bibliothek nach einer Markierung (status = null entfernt sie); reine Funktion ohne Speicherzugriff.
export function withSpeakingStatus(progress, exerciseId, status) {
  const next = { ...progress }
  if (VALID_STATUSES.includes(status)) next[exerciseId] = status
  else delete next[exerciseId]
  return next
}

// Speichert den Stand einer Bibliothek; schlaegt das fehl (Speicher voll oder gesperrt), gilt er trotzdem
// fuer die laufende Sitzung und es gibt keinen Absturz. Rueckgabe: ob gespeichert wurde.
export function saveSpeakingProgress(libraryId, progress) {
  try {
    const libraries = { ...readAll(), [libraryId]: progress }
    window.localStorage.setItem(SPEAKING_PROGRESS_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, libraries }))
    return true
  } catch {
    return false
  }
}
