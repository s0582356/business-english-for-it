// Lernbibliotheks-Schema: Bibliothek -> Bereich -> Lektion -> Szenario -> Item.
//
// Auf Item-Ebene wird vollstaendig an die bestehenden choice/ordered-
// Validatoren aus contentValidation.js delegiert (contentValidation.js
// bleibt dafuer unveraendert). Hier wird ausschliesslich die umgebende
// Hierarchie geprueft, und areaId/lessonId/scenarioId werden automatisch aus
// der Position abgeleitet - Items muessen sie nicht redundant mitbringen.

import { validateItem } from './contentValidation.js'
import { fingerprintFile } from './fingerprint.js'

const SUPPORTED_SCHEMA_VERSIONS = [1]

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function fail(message) {
  throw new Error(message)
}

export function isLibraryData(data) {
  return Boolean(data) && typeof data === 'object' && !Array.isArray(data) && data.type === 'businessEnglishLibrary'
}

function validateScenario(rawScenario, lessonLabel, index, seenScenarioIds, seenItemIds) {
  const label = `${lessonLabel} / Szenario ${index + 1}`
  if (!rawScenario || typeof rawScenario !== 'object') fail(`${label}: muss ein Objekt sein.`)
  if (!isNonEmptyString(rawScenario.scenarioId)) fail(`${label}: "scenarioId" fehlt oder ist ungültig.`)
  if (seenScenarioIds.has(rawScenario.scenarioId)) fail(`Doppelte scenarioId in der Bibliothek: "${rawScenario.scenarioId}".`)
  seenScenarioIds.add(rawScenario.scenarioId)
  if (!isNonEmptyString(rawScenario.scenarioTitle)) {
    fail(`${label} (${rawScenario.scenarioId}): "scenarioTitle" fehlt oder ist ungültig.`)
  }
  if (!Array.isArray(rawScenario.items) || rawScenario.items.length === 0) {
    fail(`${label} (${rawScenario.scenarioId}): "items" muss ein nicht leeres Array sein.`)
  }

  const items = rawScenario.items.map((rawItem, itemIndex) => {
    const itemLabel = `${label} (${rawScenario.scenarioId}), Item ${itemIndex + 1}`
    if (!rawItem || typeof rawItem !== 'object') fail(`${itemLabel}: muss ein Objekt sein.`)
    if (!isNonEmptyString(rawItem.itemId)) fail(`${itemLabel}: "itemId" fehlt oder ist ungültig.`)
    if (seenItemIds.has(rawItem.itemId)) fail(`Doppelte itemId in der Bibliothek: "${rawItem.itemId}".`)
    seenItemIds.add(rawItem.itemId)

    let validated
    try {
      // Bestehende Item-Validatoren erwarten "id" - itemId wird uebersetzt,
      // damit contentValidation.js unveraendert bleiben kann.
      validated = validateItem({ ...rawItem, id: rawItem.itemId }, itemIndex)
    } catch (error) {
      fail(`${itemLabel}: ${error.message}`)
    }

    return { ...validated, itemId: validated.id }
  })

  return { scenarioId: rawScenario.scenarioId, scenarioTitle: rawScenario.scenarioTitle, items }
}

function validateLesson(rawLesson, index, seenLessonIds, seenScenarioIds, seenItemIds) {
  const label = `Lektion ${index + 1}`
  if (!rawLesson || typeof rawLesson !== 'object') fail(`${label}: muss ein Objekt sein.`)
  if (!isNonEmptyString(rawLesson.lessonId)) fail(`${label}: "lessonId" fehlt oder ist ungültig.`)
  if (seenLessonIds.has(rawLesson.lessonId)) fail(`Doppelte lessonId in der Bibliothek: "${rawLesson.lessonId}".`)
  seenLessonIds.add(rawLesson.lessonId)
  if (!isNonEmptyString(rawLesson.lessonTitle)) fail(`${label} (${rawLesson.lessonId}): "lessonTitle" fehlt oder ist ungültig.`)
  if (!Array.isArray(rawLesson.scenarios) || rawLesson.scenarios.length === 0) {
    fail(`${label} (${rawLesson.lessonId}): "scenarios" muss ein nicht leeres Array sein.`)
  }

  const lessonLabel = `${label} (${rawLesson.lessonId})`
  const scenarios = rawLesson.scenarios.map((rawScenario, scenarioIndex) =>
    validateScenario(rawScenario, lessonLabel, scenarioIndex, seenScenarioIds, seenItemIds),
  )

  return { lessonId: rawLesson.lessonId, lessonTitle: rawLesson.lessonTitle, scenarios }
}

export function validateLibrary(data) {
  if (!isLibraryData(data)) {
    fail('Datei wird nicht als Business-English-Lernbibliothek erkannt ("type" fehlt oder ist falsch).')
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(data.schemaVersion)) {
    fail(`Nicht unterstützte schemaVersion "${data.schemaVersion}". Unterstützt wird aktuell nur 1.`)
  }
  if (!isNonEmptyString(data.libraryId)) fail('"libraryId" fehlt oder ist ungültig.')
  if (!isPositiveInteger(data.libraryVersion)) fail('"libraryVersion" muss eine positive Ganzzahl sein.')
  if (!isNonEmptyString(data.areaId)) fail('"areaId" fehlt oder ist ungültig.')
  if (!isNonEmptyString(data.areaTitle)) fail('"areaTitle" fehlt oder ist ungültig.')
  if (!Array.isArray(data.lessons) || data.lessons.length === 0) fail('"lessons" muss ein nicht leeres Array sein.')

  const seenLessonIds = new Set()
  const seenScenarioIds = new Set()
  const seenItemIds = new Set()

  const lessons = data.lessons.map((rawLesson, index) =>
    validateLesson(rawLesson, index, seenLessonIds, seenScenarioIds, seenItemIds),
  )

  // Einmalige Ableitung der Hierarchie-Felder je Item aus der Position -
  // Items muessen areaId/lessonId/scenarioId nicht selbst mitbringen.
  const annotatedLessons = lessons.map((lesson) => ({
    ...lesson,
    scenarios: lesson.scenarios.map((scenario) => ({
      ...scenario,
      items: scenario.items.map((item) => ({
        ...item,
        areaId: data.areaId,
        lessonId: lesson.lessonId,
        scenarioId: scenario.scenarioId,
      })),
    })),
  }))

  return {
    type: 'businessEnglishLibrary',
    schemaVersion: data.schemaVersion,
    libraryId: data.libraryId,
    libraryVersion: data.libraryVersion,
    areaId: data.areaId,
    areaTitle: data.areaTitle,
    lessons: annotatedLessons,
  }
}

export function flattenLibraryItems(library) {
  const items = []
  for (const lesson of library.lessons) {
    for (const scenario of lesson.scenarios) {
      items.push(...scenario.items)
    }
  }
  return items
}

// Deterministische Konfliktentscheidung fuer zwei Bibliotheken mit gleicher
// areaId. Kein lexikografischer Trick: libraryVersion wird als Ganzzahl
// verglichen (bereits beim Validieren als positive Ganzzahl erzwungen).
export function classifyIncomingLibrary(existingEntry, incomingEntry) {
  if (!existingEntry) return { action: 'load' }
  if (existingEntry.fingerprint === incomingEntry.fingerprint) return { action: 'duplicate' }

  const existingLib = existingEntry.library
  const incomingLib = incomingEntry.library

  if (existingLib.libraryId === incomingLib.libraryId) {
    if (existingLib.libraryVersion === incomingLib.libraryVersion) {
      return { action: 'conflict', reason: 'same-version-different-fingerprint' }
    }
    if (incomingLib.libraryVersion > existingLib.libraryVersion) {
      return { action: 'upgrade' }
    }
    return { action: 'ignore-older' }
  }

  return { action: 'conflict', reason: 'different-library-id' }
}

export async function importLibraryFiles(files, currentRegistry = { libraryByAreaId: {}, conflictsByAreaId: {} }) {
  const libraryByAreaId = { ...currentRegistry.libraryByAreaId }
  const conflictsByAreaId = { ...currentRegistry.conflictsByAreaId }
  const report = { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] }

  for (const file of [...files]) {
    let parsed
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      report.errors.push({ fileName: file.name, reason: 'Datei ist kein gültiges JSON.' })
      continue
    }

    let library
    try {
      library = validateLibrary(parsed)
    } catch (error) {
      report.errors.push({ fileName: file.name, reason: error.message })
      continue
    }

    const fingerprint = await fingerprintFile(file)
    const incomingEntry = { library, fileName: file.name, fingerprint }
    const existingEntry = libraryByAreaId[library.areaId] || null
    const classification = classifyIncomingLibrary(existingEntry, incomingEntry)

    if (classification.action === 'load' || classification.action === 'upgrade') {
      libraryByAreaId[library.areaId] = incomingEntry
      delete conflictsByAreaId[library.areaId]
      report[classification.action === 'upgrade' ? 'upgrades' : 'loaded'].push({
        fileName: file.name,
        areaId: library.areaId,
        libraryVersion: library.libraryVersion,
      })
    } else if (classification.action === 'duplicate') {
      report.duplicates.push({ fileName: file.name, areaId: library.areaId })
    } else if (classification.action === 'ignore-older') {
      report.ignored.push({
        fileName: file.name,
        areaId: library.areaId,
        reason: 'Ältere libraryVersion als bereits geladene Bibliothek.',
      })
    } else {
      // Echter Konflikt: keine der beiden Bibliotheken darf aktiv bleiben,
      // unabhängig davon, welche zuerst importiert wurde (Reihenfolge-
      // Unabhängigkeit). Eine zuvor aktive Bibliothek wird hier bewusst
      // wieder entfernt - "first wins"/"last wins" ist ausdrücklich nicht
      // gewünscht.
      delete libraryByAreaId[library.areaId]
      conflictsByAreaId[library.areaId] = {
        areaId: library.areaId,
        reason: classification.reason,
        candidates: [
          existingEntry
            ? { fileName: existingEntry.fileName, libraryId: existingEntry.library.libraryId, libraryVersion: existingEntry.library.libraryVersion }
            : null,
          { fileName: file.name, libraryId: library.libraryId, libraryVersion: library.libraryVersion },
        ].filter(Boolean),
      }
      report.conflicts.push({ fileName: file.name, areaId: library.areaId, reason: classification.reason })
    }
  }

  return { libraryByAreaId, conflictsByAreaId, report }
}
