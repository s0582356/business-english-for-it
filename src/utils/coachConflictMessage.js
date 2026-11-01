// Meldungstext fuer einen Eintrag aus report.conflicts des Coach-Imports. Reine Anzeige:
// Die Konfliktbehandlung (coachImport.js) und das Datenformat bleiben unveraendert.
//   reason:    'different-library-id' | 'same-version-different-fingerprint'
//   keptExisting: die bisher geladene Bibliothek bleibt aktiv (Batch-Konflikt neben einer geladenen Bibliothek)
//   hadLoaded: vor diesem Import war eine Bibliothek geladen (dann wurde sie bei keptExisting=false deaktiviert)
export function coachConflictMessage(entry, hadLoaded = false) {
  let cause
  if (entry.reason === 'different-library-id') {
    cause = 'gehört zu einer anderen Lerncoach-Bibliothek als eine andere Datei (unterschiedliche Bibliotheks-ID).'
  } else if (entry.reason === 'same-version-different-fingerprint') {
    cause = 'widerspricht einer anderen Datei (gleiche Bibliothek und Version, aber unterschiedlicher Inhalt).'
  } else {
    cause = 'widerspricht einer anderen Datei.'
  }
  let outcome
  if (entry.keptExisting) outcome = 'Die bisher geladene Lerncoach-Bibliothek bleibt aktiv.'
  else if (hadLoaded) outcome = 'Die bisher geladene Lerncoach-Bibliothek wurde wegen des Konflikts deaktiviert (gespeicherter Lernstand bleibt erhalten).'
  else outcome = 'Keine dieser Dateien wird verwendet.'
  return `Konflikt bei der Lerncoach-Bibliothek: „${entry.fileName}" ${cause} ${outcome}`
}
