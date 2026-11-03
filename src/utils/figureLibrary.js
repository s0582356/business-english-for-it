// Diagramm-Figuren fuer Aufgaben: eigenes privates Dateiformat ("businessEnglishFigures"),
// getrennt von Quiz-Bibliotheken und Lerncoach. Die Datei enthaelt ausschliesslich Daten
// (Zahlen und Texte); es wird nichts ausgefuehrt und kein Text als HTML ausgewertet.
//
// Aufgaben bleiben unveraendert: Eine Figur wird ueber eine Bindung (areaId + itemId + figureId)
// an eine vorhandene Aufgabe gehaengt. Fortschritt haengt an areaId + itemId und bleibt unberuehrt.
//
// Versionsvertrag wie bei den anderen Bibliotheken: libraryId (stabil) + libraryVersion (positive Ganzzahl).

import { flattenLibraryItems } from './libraryImport.js'

export const FIGURE_LIBRARY_TYPE = 'businessEnglishFigures'
export const FIGURE_CHART_TYPES = ['line', 'bar']

// Schema 1: Figuren + Bindungen. Schema 2 ergaenzt dasselbe um optionale Sprechtrainings-Daten ("speaking") je Figur.
// Aeltere Dateien (Schema 1) bleiben unveraendert gueltig und haben schlicht kein Sprechtraining.
const SUPPORTED_SCHEMA_VERSIONS = [1, 2]
export const SPEAKING_MIN_SCHEMA_VERSION = 2
// Rollen der Beispielsaetze in der didaktischen Reihenfolge (Anzeige-Labels stehen in ChartSpeaking.vue).
export const SPEAKING_ROLES = ['introduce', 'initial', 'development', 'key-figures', 'summary']

// Obergrenzen gegen versehentlich riesige oder missbrauchte Dateien.
export const FIGURE_LIMITS = Object.freeze({
  fileBytes: 512 * 1024,
  figures: 100,
  bindings: 500,
  categories: 24,
  series: 6,
  idLength: 120,
  titleLength: 200,
  labelLength: 80,
  categoryLength: 60,
  seriesNameLength: 60,
  textAlternativeLength: 1500,
  maxAbsValue: 1e9,
  speakingSentences: 8,
  sentenceLength: 300,
  noteLength: 400,
})

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function fail(message) {
  throw new Error(message)
}

function requireText(value, label, field, maxLength) {
  if (!isNonEmptyString(value)) fail(`${label}: "${field}" fehlt oder ist ungültig.`)
  if (value.length > maxLength) fail(`${label}: "${field}" ist zu lang (höchstens ${maxLength} Zeichen).`)
  return value.trim()
}

export function isFigureLibraryData(data) {
  return Boolean(data) && typeof data === 'object' && !Array.isArray(data) && data.type === FIGURE_LIBRARY_TYPE
}

function validateSpeaking(raw, label, schemaVersion) {
  if (raw === undefined) return null
  if (schemaVersion < SPEAKING_MIN_SCHEMA_VERSION) fail(`${label}: "speaking" erfordert schemaVersion ${SPEAKING_MIN_SCHEMA_VERSION}.`)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${label}: "speaking" muss ein Objekt sein.`)
  if (!Array.isArray(raw.sentences) || raw.sentences.length < 1 || raw.sentences.length > FIGURE_LIMITS.speakingSentences) {
    fail(`${label}: "speaking.sentences" muss 1 bis ${FIGURE_LIMITS.speakingSentences} Einträge enthalten.`)
  }
  const seen = new Set()
  const sentences = raw.sentences.map((entry, index) => {
    const where = `${label} / Beispielsatz ${index + 1}`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`${where}: muss ein Objekt sein.`)
    const sentenceId = requireText(entry.sentenceId, where, 'sentenceId', FIGURE_LIMITS.idLength)
    if (seen.has(sentenceId)) fail(`${where}: "sentenceId" kommt mehrfach vor.`)
    seen.add(sentenceId)
    if (!SPEAKING_ROLES.includes(entry.role)) fail(`${where}: "role" muss "${SPEAKING_ROLES.join('", "')}" sein, nicht "${entry.role}".`)
    return {
      sentenceId,
      role: entry.role,
      en: requireText(entry.en, where, 'en', FIGURE_LIMITS.sentenceLength),
      de: requireText(entry.de, where, 'de', FIGURE_LIMITS.sentenceLength),
      note: requireText(entry.note, where, 'note', FIGURE_LIMITS.noteLength),
    }
  })
  return { sentences }
}

function validateFigure(raw, index, seenIds, schemaVersion) {
  const where = `Figur ${index + 1}`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${where}: muss ein Objekt sein.`)
  const figureId = requireText(raw.figureId, where, 'figureId', FIGURE_LIMITS.idLength)
  const label = `${where} (${figureId})`
  if (seenIds.has(figureId)) fail(`${label}: "figureId" kommt mehrfach vor.`)
  seenIds.add(figureId)
  if (!FIGURE_CHART_TYPES.includes(raw.chartType)) {
    fail(`${label}: "chartType" muss "${FIGURE_CHART_TYPES.join('" oder "')}" sein, nicht "${raw.chartType}".`)
  }

  const categories = raw.categories
  if (!Array.isArray(categories) || categories.length < 1 || categories.length > FIGURE_LIMITS.categories) {
    fail(`${label}: "categories" muss 1 bis ${FIGURE_LIMITS.categories} Einträge enthalten.`)
  }
  const cleanCategories = categories.map((category) => requireText(category, label, 'categories', FIGURE_LIMITS.categoryLength))
  if (raw.chartType === 'line' && cleanCategories.length < 2) fail(`${label}: Ein Liniendiagramm braucht mindestens 2 Kategorien.`)

  if (!Array.isArray(raw.series) || raw.series.length < 1 || raw.series.length > FIGURE_LIMITS.series) {
    fail(`${label}: "series" muss 1 bis ${FIGURE_LIMITS.series} Einträge enthalten.`)
  }
  const seriesNames = new Set()
  const series = raw.series.map((entry, seriesIndex) => {
    const seriesLabel = `${label} / Reihe ${seriesIndex + 1}`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`${seriesLabel}: muss ein Objekt sein.`)
    const name = requireText(entry.name, seriesLabel, 'name', FIGURE_LIMITS.seriesNameLength)
    if (seriesNames.has(name)) fail(`${seriesLabel}: Der Reihenname "${name}" kommt mehrfach vor.`)
    seriesNames.add(name)
    if (!Array.isArray(entry.values) || entry.values.length !== cleanCategories.length) {
      fail(`${seriesLabel}: "values" braucht genau ${cleanCategories.length} Werte (einen je Kategorie).`)
    }
    for (const value of entry.values) {
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > FIGURE_LIMITS.maxAbsValue) {
        fail(`${seriesLabel}: "values" darf nur endliche Zahlen (Betrag höchstens ${FIGURE_LIMITS.maxAbsValue}) enthalten.`)
      }
    }
    return { name, values: [...entry.values] }
  })

  const speaking = validateSpeaking(raw.speaking, label, schemaVersion)

  return {
    figureId,
    chartType: raw.chartType,
    title: requireText(raw.title, label, 'title', FIGURE_LIMITS.titleLength),
    xAxisLabel: requireText(raw.xAxisLabel, label, 'xAxisLabel', FIGURE_LIMITS.labelLength),
    yAxisLabel: requireText(raw.yAxisLabel, label, 'yAxisLabel', FIGURE_LIMITS.labelLength),
    unit: requireText(raw.unit, label, 'unit', FIGURE_LIMITS.labelLength),
    categories: cleanCategories,
    series,
    textAlternative: requireText(raw.textAlternative, label, 'textAlternative', FIGURE_LIMITS.textAlternativeLength),
    ...(speaking ? { speaking } : {}),
  }
}

// Prueft und baut die Bibliothek aus festen Feldern neu auf (unbekannte Felder werden verworfen).
export function validateFigureLibrary(data) {
  if (!isFigureLibraryData(data)) fail(`Keine Figuren-Bibliothek (erwartet: "type": "${FIGURE_LIBRARY_TYPE}").`)
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(data.schemaVersion)) {
    fail(`Figuren-Bibliothek: schemaVersion ${data.schemaVersion} wird nicht unterstützt (unterstützt: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}).`)
  }
  const libraryId = requireText(data.libraryId, 'Figuren-Bibliothek', 'libraryId', FIGURE_LIMITS.idLength)
  if (!Number.isInteger(data.libraryVersion) || data.libraryVersion <= 0) {
    fail('Figuren-Bibliothek: "libraryVersion" muss eine positive Ganzzahl sein.')
  }
  const areaId = requireText(data.areaId, 'Figuren-Bibliothek', 'areaId', FIGURE_LIMITS.idLength)

  if (!Array.isArray(data.figures) || data.figures.length < 1 || data.figures.length > FIGURE_LIMITS.figures) {
    fail(`Figuren-Bibliothek: "figures" muss 1 bis ${FIGURE_LIMITS.figures} Einträge enthalten.`)
  }
  const seenIds = new Set()
  const figures = data.figures.map((raw, index) => validateFigure(raw, index, seenIds, data.schemaVersion))

  if (!Array.isArray(data.bindings) || data.bindings.length < 1 || data.bindings.length > FIGURE_LIMITS.bindings) {
    fail(`Figuren-Bibliothek: "bindings" muss 1 bis ${FIGURE_LIMITS.bindings} Einträge enthalten.`)
  }
  const boundItems = new Set()
  const bindings = data.bindings.map((raw, index) => {
    const where = `Bindung ${index + 1}`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`${where}: muss ein Objekt sein.`)
    const bindingArea = requireText(raw.areaId, where, 'areaId', FIGURE_LIMITS.idLength)
    const itemId = requireText(raw.itemId, where, 'itemId', FIGURE_LIMITS.idLength)
    const figureId = requireText(raw.figureId, where, 'figureId', FIGURE_LIMITS.idLength)
    if (bindingArea !== areaId) fail(`${where}: "areaId" ("${bindingArea}") weicht vom Bereich der Bibliothek ("${areaId}") ab.`)
    if (!seenIds.has(figureId)) fail(`${where}: Die Figur "${figureId}" ist nicht definiert.`)
    if (boundItems.has(itemId)) fail(`${where}: Die Aufgabe "${itemId}" ist mehrfach gebunden.`)
    boundItems.add(itemId)
    return { areaId: bindingArea, itemId, figureId }
  })

  return { type: FIGURE_LIBRARY_TYPE, schemaVersion: data.schemaVersion, libraryId, libraryVersion: data.libraryVersion, areaId, figures, bindings }
}

// Liefert die Figur zu einer Aufgabe oder null (Aufgaben ohne Figur bleiben unveraendert).
export function getFigureForItem(entry, areaId, itemId) {
  const library = entry?.library
  if (!library || library.areaId !== areaId) return null
  const binding = library.bindings.find((candidate) => candidate.itemId === itemId)
  if (!binding) return null
  return library.figures.find((figure) => figure.figureId === binding.figureId) ?? null
}

// Bindungen, deren Aufgabe in der geladenen Quiz-Bibliothek des Bereichs nicht existiert.
// Ist der Bereich (noch) nicht geladen, gibt es nichts zu melden (Reihenfolge der Importe ist egal).
export function findUnmatchedBindings(entry, libraryEntry) {
  if (!entry || !libraryEntry?.library) return []
  const knownIds = new Set(flattenLibraryItems(libraryEntry.library).map((item) => item.id))
  return entry.library.bindings.filter((binding) => !knownIds.has(binding.itemId)).map((binding) => binding.itemId)
}
