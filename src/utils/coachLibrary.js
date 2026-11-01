// Lerncoach-Bibliothek: Bibliothek -> Einheit -> Schritt.
//
// Eigenes Dateiformat ("businessEnglishCoach"), getrennt von den Quiz-
// Lernbibliotheken. Die Schritte "choice" und "gap" delegieren vollstaendig an
// die bestehenden Item-Validatoren aus contentValidation.js (dieselben Felder
// wie im Quiz), damit ChoiceCard/GapInputTrainer und die Audio-Sprechtext-
// Ableitung unveraendert wiederverwendet werden koennen.
//
// Versionsvertrag: libraryId (stabil) + libraryVersion (positive Ganzzahl).
// Jeder Schritt hat eine stabile stepId; revision ist ein reiner Inhalts-
// Fingerabdruck pro Schritt, damit spaetere Bibliotheksversionen erkannt werden,
// ohne gespeicherte Lernstaende zu loeschen (siehe coachStorage.js).

import { validateItem } from './contentValidation.js'

export const COACH_LIBRARY_TYPE = 'businessEnglishCoach'
export const COACH_AREA_ID = 'w3-lerncoach'
export const COACH_STEP_TYPES = ['explain', 'examples', 'choice', 'gap', 'produce', 'recap']
// Schritte, die geuebt werden (Wiederholung, Resume-Statistik).
export const COACH_EXERCISE_TYPES = ['choice', 'gap', 'produce']

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

function requireText(value, label, field) {
  if (!isNonEmptyString(value)) fail(`${label}: "${field}" fehlt oder ist ungültig.`)
}

function requireTextList(value, label, field) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNonEmptyString)) {
    fail(`${label}: "${field}" muss mindestens einen nicht-leeren Text enthalten.`)
  }
}

export function isCoachLibraryData(data) {
  return Boolean(data) && typeof data === 'object' && !Array.isArray(data) && data.type === COACH_LIBRARY_TYPE
}

// Stabiler, kurzer Inhalts-Fingerabdruck (FNV-1a ueber kanonisches JSON).
// Dient nur der Aenderungserkennung, nicht der Sicherheit.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function contentRevision(value) {
  const text = canonical(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function validateStep(rawStep, unitLabel, index, ids) {
  const label = `${unitLabel} / Schritt ${index + 1}`
  if (!rawStep || typeof rawStep !== 'object') fail(`${label}: muss ein Objekt sein.`)
  if (!isNonEmptyString(rawStep.stepId)) fail(`${label}: "stepId" fehlt oder ist ungültig.`)
  const stepLabel = `${label} (${rawStep.stepId})`
  if (!COACH_STEP_TYPES.includes(rawStep.type)) {
    fail(`${stepLabel}: "type" muss "${COACH_STEP_TYPES.join('", "')}" sein, nicht "${rawStep.type}".`)
  }
  claimId(ids, rawStep.stepId, 'stepId')

  let validated
  if (rawStep.type === 'explain') {
    requireText(rawStep.title, stepLabel, 'title')
    requireTextList(rawStep.paragraphs, stepLabel, 'paragraphs')
    for (const field of ['pattern', 'caution']) {
      if (rawStep[field] !== undefined && !isNonEmptyString(rawStep[field])) fail(`${stepLabel}: "${field}" muss ein nicht-leerer Text sein, falls angegeben.`)
    }
    validated = { title: rawStep.title, paragraphs: [...rawStep.paragraphs], pattern: rawStep.pattern ?? null, caution: rawStep.caution ?? null }
  } else if (rawStep.type === 'examples') {
    requireText(rawStep.title, stepLabel, 'title')
    if (rawStep.intro !== undefined && !isNonEmptyString(rawStep.intro)) fail(`${stepLabel}: "intro" muss ein nicht-leerer Text sein, falls angegeben.`)
    if (!Array.isArray(rawStep.examples) || rawStep.examples.length === 0) fail(`${stepLabel}: "examples" muss ein nicht leeres Array sein.`)
    const examples = rawStep.examples.map((example, exampleIndex) => {
      const exampleLabel = `${stepLabel}, Beispiel ${exampleIndex + 1}`
      if (!example || typeof example !== 'object') fail(`${exampleLabel}: muss ein Objekt sein.`)
      requireText(example.exampleId, exampleLabel, 'exampleId')
      claimId(ids, example.exampleId, 'exampleId')
      requireText(example.en, exampleLabel, 'en')
      requireText(example.de, exampleLabel, 'de')
      if (example.level !== undefined && !isNonEmptyString(example.level)) fail(`${exampleLabel}: "level" muss ein nicht-leerer Text sein, falls angegeben.`)
      return { id: example.exampleId, itemId: example.exampleId, type: 'example', en: example.en, de: example.de, level: example.level ?? null, note: isNonEmptyString(example.note) ? example.note : null }
    })
    validated = { title: rawStep.title, intro: rawStep.intro ?? null, examples }
  } else if (rawStep.type === 'choice' || rawStep.type === 'gap') {
    let item
    try {
      item = validateItem({ ...rawStep, id: rawStep.stepId }, index)
    } catch (error) {
      fail(`${stepLabel}: ${error.message}`)
    }
    if (rawStep.type === 'gap' && (item.prompt.match(/_{2,}/g) ?? []).length !== 1) {
      fail(`${stepLabel}: Die Lückenaufgabe braucht genau eine Lücke ("___").`)
    }
    validated = { ...item, itemId: item.id }
  } else if (rawStep.type === 'produce') {
    requireText(rawStep.prompt, stepLabel, 'prompt')
    requireTextList(rawStep.checklist, stepLabel, 'checklist')
    requireTextList(rawStep.modelAnswers, stepLabel, 'modelAnswers')
    requireText(rawStep.feedback, stepLabel, 'feedback')
    validated = { id: rawStep.stepId, itemId: rawStep.stepId, prompt: rawStep.prompt, checklist: [...rawStep.checklist], modelAnswers: [...rawStep.modelAnswers], feedback: rawStep.feedback }
  } else {
    requireText(rawStep.title, stepLabel, 'title')
    requireTextList(rawStep.points, stepLabel, 'points')
    requireText(rawStep.recommendation, stepLabel, 'recommendation')
    validated = { title: rawStep.title, points: [...rawStep.points], recommendation: rawStep.recommendation }
  }

  const step = { ...validated, stepId: rawStep.stepId, type: rawStep.type }
  return { ...step, revision: contentRevision(step) }
}

function claimId(ids, id, field) {
  if (ids.has(id)) fail(`Doppelte ${field} in der Coach-Bibliothek: "${id}".`)
  ids.add(id)
}

function validateUnit(rawUnit, index, unitIds, ids) {
  const label = `Einheit ${index + 1}`
  if (!rawUnit || typeof rawUnit !== 'object') fail(`${label}: muss ein Objekt sein.`)
  requireText(rawUnit.unitId, label, 'unitId')
  if (unitIds.has(rawUnit.unitId)) fail(`Doppelte unitId in der Coach-Bibliothek: "${rawUnit.unitId}".`)
  unitIds.add(rawUnit.unitId)
  const unitLabel = `${label} (${rawUnit.unitId})`
  requireText(rawUnit.unitTitle, unitLabel, 'unitTitle')
  requireText(rawUnit.level, unitLabel, 'level')
  requireText(rawUnit.goal, unitLabel, 'goal')
  if (!isPositiveInteger(rawUnit.estimatedMinutes)) fail(`${unitLabel}: "estimatedMinutes" muss eine positive Ganzzahl sein.`)
  if (!Array.isArray(rawUnit.steps) || rawUnit.steps.length === 0) fail(`${unitLabel}: "steps" muss ein nicht leeres Array sein.`)

  const steps = rawUnit.steps.map((rawStep, stepIndex) => validateStep(rawStep, unitLabel, stepIndex, ids))
  return {
    unitId: rawUnit.unitId,
    unitTitle: rawUnit.unitTitle,
    level: rawUnit.level,
    goal: rawUnit.goal,
    estimatedMinutes: rawUnit.estimatedMinutes,
    steps,
  }
}

export function validateCoachLibrary(data) {
  if (!isCoachLibraryData(data)) fail('Datei wird nicht als Business-English-Lerncoach-Bibliothek erkannt ("type" fehlt oder ist falsch).')
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(data.schemaVersion)) {
    fail(`Nicht unterstützte schemaVersion "${data.schemaVersion}". Unterstützt wird aktuell nur 1.`)
  }
  if (!isNonEmptyString(data.libraryId)) fail('"libraryId" fehlt oder ist ungültig.')
  if (!isPositiveInteger(data.libraryVersion)) fail('"libraryVersion" muss eine positive Ganzzahl sein.')
  if (data.areaId !== COACH_AREA_ID) fail(`"areaId" muss "${COACH_AREA_ID}" sein (Fortschritt und Audio-Dateinamen hängen daran).`)
  if (!isNonEmptyString(data.areaTitle)) fail('"areaTitle" fehlt oder ist ungültig.')
  if (!Array.isArray(data.units) || data.units.length === 0) fail('"units" muss ein nicht leeres Array sein.')

  const unitIds = new Set()
  const ids = new Set()
  const units = data.units.map((rawUnit, index) => validateUnit(rawUnit, index, unitIds, ids))
  // areaId wird (wie bei den Quiz-Bibliotheken) aus der Position abgeleitet und fuer Audio an jedes Item gehaengt.
  const annotate = (target) => ({ ...target, areaId: data.areaId })
  const annotatedUnits = units.map((unit) => ({
    ...unit,
    steps: unit.steps.map((step) => (step.type === 'examples' ? { ...step, examples: step.examples.map(annotate) } : annotate(step))),
  }))

  return {
    type: COACH_LIBRARY_TYPE,
    schemaVersion: data.schemaVersion,
    libraryId: data.libraryId,
    libraryVersion: data.libraryVersion,
    areaId: data.areaId,
    areaTitle: data.areaTitle,
    units: annotatedUnits,
  }
}

export function isExerciseStep(step) {
  return COACH_EXERCISE_TYPES.includes(step?.type)
}
