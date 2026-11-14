// Gemeinsamer Importpfad fuer private JSON-Dateien (Quiz-Bibliotheken, Lerncoach, Figuren, Uebungen).
//
// Dieselbe Funktion bedient sowohl die Auswahl im Dateiwaehler als auch das Wiederherstellen gespeicherter Dateien
// beim App-Start. Es gibt dadurch genau EINE Validierungs- und Aktivierungslogik: Versions-, Duplikat- und
// Konfliktregeln sind identisch, egal ob die Datei frisch gewaehlt oder aus dem lokalen Speicher geladen wurde.
//
// Die Ergebnisse werden ueber `apply` (ein Callback je Art) an die App gereicht; zurueck kommen die einzelnen
// Vorgaenge, damit der Aufrufer die tatsaechlich aktivierten Dateien speichern kann.

import { importLibraryFiles } from './libraryImport.js'
import { importCoachFiles, partitionCoachFiles } from './coachImport.js'
import { importFigureFiles, partitionFigureFiles } from './figureImport.js'
import { importSpeakingFiles, partitionSpeakingFiles } from './speakingImport.js'
import { LIBRARY_KIND } from './privateLibraryStore.js'

const failureReport = (files, error) => ({
  loaded: [],
  upgrades: [],
  duplicates: [],
  ignored: [],
  conflicts: [],
  errors: files.map((file) => ({ fileName: file.name, reason: error?.message || 'Unbekannter Fehler beim Lesen.' })),
})

// `getRegistries()` liefert den aktuellen Stand { quiz, coach, figures, speaking }. Die Reihenfolge der Vorgaenge
// (Bibliotheken zuerst, dann Lerncoach, Figuren, Sprechuebungen) entspricht dem bisherigen Import.
export async function runJsonImport(jsonFiles, getRegistries, apply) {
  const outcomes = []
  // Lerncoach-Bibliotheken (type "businessEnglishCoach") laufen ueber denselben Dateiwaehler,
  // werden aber getrennt von den Quiz-Bibliotheken importiert.
  const { coachFiles, otherFiles: nonCoachFiles } = await partitionCoachFiles(jsonFiles)
  // Diagramm-Figuren (type "businessEnglishFigures"): eigene optionale Datei, getrennt importiert, damit ein
  // fehlerhafter Figuren-Import die Quiz-Bibliotheken nie beeintraechtigt.
  const { figureFiles, otherFiles: nonFigureFiles } = await partitionFigureFiles(nonCoachFiles)
  // Sprechuebungen (type "businessEnglishEasySpeaking"): ebenfalls eigene optionale Datei.
  const { speakingFiles, otherFiles: libraryFiles } = await partitionSpeakingFiles(nonFigureFiles)

  if (libraryFiles.length > 0) {
    const result = await importLibraryFiles(libraryFiles, getRegistries().quiz)
    apply.quiz(result)
    outcomes.push({ kind: LIBRARY_KIND.QUIZ, files: libraryFiles, result })
  }
  if (coachFiles.length > 0) {
    const result = await importCoachFiles(coachFiles, getRegistries().coach)
    apply.coach(result)
    outcomes.push({ kind: LIBRARY_KIND.COACH, files: coachFiles, result })
  }
  if (figureFiles.length > 0) {
    let result
    try {
      result = await importFigureFiles(figureFiles, getRegistries().figures)
    } catch (error) {
      const current = getRegistries().figures
      result = { ...current, entry: current.entry ?? null, conflict: current.conflict ?? null, report: failureReport(figureFiles, error) }
    }
    apply.figures(result)
    outcomes.push({ kind: LIBRARY_KIND.FIGURES, files: figureFiles, result })
  }
  if (speakingFiles.length > 0) {
    let result
    try {
      result = await importSpeakingFiles(speakingFiles, getRegistries().speaking)
    } catch (error) {
      const current = getRegistries().speaking ?? {}
      result = { ...current, entry: current.entry ?? null, conflict: current.conflict ?? null, report: failureReport(speakingFiles, error) }
    }
    apply.speaking(result)
    outcomes.push({ kind: LIBRARY_KIND.SPEAKING, files: speakingFiles, result })
  }
  return outcomes
}
