// Import der privaten Sprech-Bibliothek ueber denselben Dateiwaehler wie die uebrigen privaten Dateien.
// Versions-, Duplikat- und Konfliktregeln sowie die Reihenfolge-Unabhaengigkeit stammen aus importCoachFiles
// (Batch-Entscheidung); hier kommen Typerkennung und das eigene Groessenlimit dazu. Die Speicherung und
// Wiederherstellung laufen ueber den gemeinsamen Pfad (privateLibraryController / privateImportPipeline).

import { importCoachFiles } from './coachImport.js'
import { SPEAKING_LIMITS, isSpeakingLibraryData, validateSpeakingLibrary } from './speakingLibrary.js'
import { isOversizedFile, oversizeReason } from './importLimits.js'

export const EMPTY_SPEAKING_REGISTRY = Object.freeze({ entry: null, conflict: null })

// Trennt Sprech-Dateien von allen anderen Dateien (am "type" im JSON).
export async function partitionSpeakingFiles(files) {
  const speakingFiles = []
  const otherFiles = []
  for (const file of [...files]) {
    let isSpeaking = false
    // Dateien oberhalb des uebergreifenden Limits werden weder gelesen noch geparst; der normale Import meldet sie.
    if (!isOversizedFile(file)) {
      try {
        isSpeaking = isSpeakingLibraryData(JSON.parse(await file.text()))
      } catch {
        isSpeaking = false
      }
    }
    ;(isSpeaking ? speakingFiles : otherFiles).push(file)
  }
  return { speakingFiles, otherFiles }
}

// Ein fehlerhafter Import beschaedigt nie die geladene Sprech-Bibliothek: Fehler betreffen nur die jeweilige Datei.
export async function importSpeakingFiles(files, currentRegistry = EMPTY_SPEAKING_REGISTRY) {
  const oversized = []
  const accepted = []
  for (const file of [...files]) (isOversizedFile(file, SPEAKING_LIMITS.fileBytes) ? oversized : accepted).push(file)

  const result = await importCoachFiles(accepted, currentRegistry, validateSpeakingLibrary)
  for (const file of oversized) result.report.errors.push({ fileName: file.name, reason: oversizeReason(SPEAKING_LIMITS.fileBytes) })
  return result
}
