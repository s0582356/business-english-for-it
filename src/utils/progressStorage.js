// Bewusst minimale Fortschritts-Persistenz fuer den ersten Slice.
//
// Gespeichert werden AUSSCHLIESSLICH technische Metadaten zu einer bereits
// abgeschlossenen Lernrunde - niemals der private Lerninhalt selbst (keine
// Prompts, Optionen, Erklaerungen). Der Fingerprint identifiziert das private
// Paket, ohne es zu speichern. Es gibt bewusst KEIN Wieder-Einstiegs-Feature
// mitten in einer Lernrunde (kein Resume-Zustand) - das waere fuer diesen
// Slice unnoetige Komplexitaet. Die fingerprint-basierte Struktur bildet aber
// die Grundlage, auf der ein spaeteres Resume aufbauen koennte.

export const PROGRESS_STORAGE_KEY = 'businessEnglishProgress:v1'

const SCHEMA_VERSION = 1
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, summaryByFingerprint: {} }
}

function storageAvailable() {
  return typeof window !== 'undefined' && !!window.localStorage
}

function sanitizeSummary(summary) {
  if (!summary || typeof summary !== 'object') return null
  const { fileName, itemCount, score, incorrectItemIds, completedAt } = summary
  if (typeof fileName !== 'string' || !fileName) return null
  if (!Number.isInteger(itemCount) || itemCount < 1) return null
  if (!Number.isInteger(score) || score < 0 || score > itemCount) return null
  if (!Array.isArray(incorrectItemIds) || !incorrectItemIds.every((id) => typeof id === 'string')) return null
  if (typeof completedAt !== 'string' || Number.isNaN(Date.parse(completedAt))) return null

  // Explizite Allowlist: kein beliebiges Fremdobjekt wird gespeichert.
  return {
    fileName,
    itemCount,
    score,
    incorrectItemIds: [...incorrectItemIds],
    completedAt,
  }
}

function readStore() {
  if (!storageAvailable()) return emptyStore()
  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw)
    if (parsed?.schemaVersion !== SCHEMA_VERSION || typeof parsed.summaryByFingerprint !== 'object') {
      return emptyStore()
    }
    const summaryByFingerprint = {}
    for (const [fingerprint, summary] of Object.entries(parsed.summaryByFingerprint ?? {})) {
      if (!SHA256_PATTERN.test(fingerprint)) continue
      const safeSummary = sanitizeSummary(summary)
      if (safeSummary) summaryByFingerprint[fingerprint] = safeSummary
    }
    return { schemaVersion: SCHEMA_VERSION, summaryByFingerprint }
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

export function saveRunSummary(fingerprint, summary) {
  if (!SHA256_PATTERN.test(fingerprint)) return false
  const safeSummary = sanitizeSummary(summary)
  if (!safeSummary) return false
  const store = readStore()
  store.summaryByFingerprint[fingerprint] = safeSummary
  return writeStore(store)
}

export function getRunSummary(fingerprint) {
  if (!SHA256_PATTERN.test(fingerprint)) return null
  return readStore().summaryByFingerprint[fingerprint] ?? null
}

export function deleteRunSummary(fingerprint) {
  if (!SHA256_PATTERN.test(fingerprint) || !storageAvailable()) return false
  const store = readStore()
  if (!store.summaryByFingerprint[fingerprint]) return false
  delete store.summaryByFingerprint[fingerprint]
  return writeStore(store)
}

export function listRunSummaries() {
  return Object.entries(readStore().summaryByFingerprint)
    .map(([fingerprint, summary]) => ({ fingerprint, summary }))
    .sort((a, b) => b.summary.completedAt.localeCompare(a.summary.completedAt))
}
