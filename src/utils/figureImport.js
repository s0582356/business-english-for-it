// Import der privaten Figuren-Datei ueber denselben Dateiwaehler wie die uebrigen privaten Bibliotheken.
// Dateien werden nur im Browser gelesen und nur im Speicher gehalten (keine Persistenz).
// Versions-, Duplikat- und Konfliktregeln sowie die Reihenfolge-Unabhaengigkeit stammen aus
// importCoachFiles (Batch-Entscheidung); hier kommen Typerkennung und Groessenlimit dazu.

import { importCoachFiles } from './coachImport.js'
import { FIGURE_LIMITS, isFigureLibraryData, validateFigureLibrary } from './figureLibrary.js'
import { isOversizedFile, oversizeReason } from './importLimits.js'

export const EMPTY_FIGURE_REGISTRY = Object.freeze({ entry: null, conflict: null })

// Trennt Figuren-Dateien von allen anderen Dateien (am "type" im JSON).
export async function partitionFigureFiles(files) {
  const figureFiles = []
  const otherFiles = []
  for (const file of [...files]) {
    let isFigure = false
    // Dateien oberhalb des uebergreifenden Limits werden weder gelesen noch geparst; der normale Import meldet sie.
    if (!isOversizedFile(file)) {
      try {
        isFigure = isFigureLibraryData(JSON.parse(await file.text()))
      } catch {
        isFigure = false
      }
    }
    ;(isFigure ? figureFiles : otherFiles).push(file)
  }
  return { figureFiles, otherFiles }
}

// Ein fehlerhafter Import beschaedigt nie die geladene Figuren-Bibliothek: Fehler betreffen nur die jeweilige Datei.
export async function importFigureFiles(files, currentRegistry = EMPTY_FIGURE_REGISTRY) {
  const oversized = []
  const accepted = []
  for (const file of [...files]) (isOversizedFile(file, FIGURE_LIMITS.fileBytes) ? oversized : accepted).push(file)

  const result = await importCoachFiles(accepted, currentRegistry, validateFigureLibrary)
  for (const file of oversized) {
    result.report.errors.push({ fileName: file.name, reason: oversizeReason(FIGURE_LIMITS.fileBytes) })
  }
  return result
}
