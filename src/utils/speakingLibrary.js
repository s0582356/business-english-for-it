// Private Sprech-Bibliothek "W3 – Easy Speaking & Discussion": eigenes Dateiformat ("businessEnglishEasySpeaking"),
// getrennt von Quiz-Bibliothek, Lerncoach, Figuren und Uebungseinheiten. Die Datei enthaelt ausschliesslich Daten
// (Texte, Zahlen); nichts wird ausgefuehrt und kein Text als HTML ausgewertet.
//
// Jede Uebung gehoert zu genau einem von fuenf Bereichen (category) und hat eine Musterantwort, die jederzeit
// sofort aufrufbar ist - es gibt keine Bewertung, Eingabe oder Aufnahme als Voraussetzung.
// Der Lernstatus ("beherrscht" / "noch ueben") haengt an libraryId + Uebungs-ID (siehe speakingProgress.js).

export const SPEAKING_LIBRARY_TYPE = 'businessEnglishEasySpeaking'

const SUPPORTED_SCHEMA_VERSIONS = [1]

export const SPEAKING_CATEGORIES = Object.freeze([
  { id: 'easy_speaking', label: 'Easy Speaking', icon: '🗣️', hint: 'Frage und kurze Musterantwort' },
  { id: 'role_play', label: 'Role Play', icon: '🎭', hint: 'Gespräch mit klaren Rollen' },
  { id: 'business_discussion', label: 'Business Discussion', icon: '💼', hint: 'Diskussionsfrage und einfache Argumente' },
  { id: 'graph_description', label: 'Graph Description', icon: '📊', hint: 'Diagramm beschreiben' },
  { id: 'sentence_builder', label: 'Sentence Builder', icon: '🧩', hint: 'Satzbausteine ordnen' },
])
const CATEGORY_IDS = SPEAKING_CATEGORIES.map((category) => category.id)

export const SPEAKING_LIMITS = Object.freeze({
  fileBytes: 1024 * 1024,
  exercises: 1000,
  idLength: 120,
  titleLength: 200,
  shortTextLength: 200,
  textLength: 1500,
  keywords: 12,
  keywordLength: 120,
  turns: 30,
  roles: 4,
  chunks: 12,
})

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fail(message) {
  throw new Error(message)
}

function requireText(value, label, field, maxLength) {
  if (!isNonEmptyString(value)) fail(`${label}: "${field}" fehlt oder ist ungültig.`)
  if (value.length > maxLength) fail(`${label}: "${field}" ist zu lang (höchstens ${maxLength} Zeichen).`)
  return value.trim()
}

function optionalText(value, label, field, maxLength) {
  return value === undefined ? undefined : requireText(value, label, field, maxLength)
}

export function isSpeakingLibraryData(data) {
  return isPlainObject(data) && data.type === SPEAKING_LIBRARY_TYPE
}

// Stichwoerter mit deutscher Bedeutung (soweit vorhanden): { term, de? }.
function validateKeywords(raw, label) {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > SPEAKING_LIMITS.keywords) fail(`${label}: "keywords" muss höchstens ${SPEAKING_LIMITS.keywords} Einträge enthalten.`)
  return raw.map((entry) => {
    if (!isPlainObject(entry)) fail(`${label}: Stichwörter müssen Objekte sein.`)
    const keyword = { term: requireText(entry.term, label, 'keywords.term', SPEAKING_LIMITS.keywordLength) }
    const de = optionalText(entry.de, label, 'keywords.de', SPEAKING_LIMITS.keywordLength)
    if (de !== undefined) keyword.de = de
    return keyword
  })
}

function validateRolePlay(raw, label) {
  if (!isPlainObject(raw.roles)) fail(`${label}: "roles" muss ein Objekt sein.`)
  const roleKeys = Object.keys(raw.roles)
  if (roleKeys.length < 2 || roleKeys.length > SPEAKING_LIMITS.roles) fail(`${label}: "roles" muss 2 bis ${SPEAKING_LIMITS.roles} Rollen enthalten.`)
  const roles = {}
  for (const key of roleKeys) roles[key] = requireText(raw.roles[key], label, `roles.${key}`, SPEAKING_LIMITS.shortTextLength)
  if (!Array.isArray(raw.turns) || raw.turns.length < 1 || raw.turns.length > SPEAKING_LIMITS.turns) fail(`${label}: "turns" muss 1 bis ${SPEAKING_LIMITS.turns} Einträge enthalten.`)
  const turns = raw.turns.map((turn, index) => {
    const where = `${label} / Redebeitrag ${index + 1}`
    if (!isPlainObject(turn)) fail(`${where}: muss ein Objekt sein.`)
    if (!Object.hasOwn(roles, turn.speaker)) fail(`${where}: "speaker" muss eine der Rollen (${roleKeys.join(', ')}) sein.`)
    const entry = { speaker: turn.speaker, text: requireText(turn.text, where, 'text', SPEAKING_LIMITS.textLength) }
    const de = optionalText(turn.de, where, 'de', SPEAKING_LIMITS.textLength)
    if (de !== undefined) entry.de = de
    return entry
  })
  return { roles, turns }
}

function validateGraph(raw, label) {
  if (!isPlainObject(raw.chartData)) fail(`${label}: "chartData" muss ein Objekt sein.`)
  const chartData = {}
  for (const field of ['chartType', 'timeframe', 'metric', 'values']) chartData[field] = requireText(raw.chartData[field], label, `chartData.${field}`, SPEAKING_LIMITS.shortTextLength)
  return { chartData }
}

function validateSentenceBuilder(raw, label) {
  if (!Array.isArray(raw.chunks) || raw.chunks.length < 2 || raw.chunks.length > SPEAKING_LIMITS.chunks) fail(`${label}: "chunks" muss 2 bis ${SPEAKING_LIMITS.chunks} Einträge enthalten.`)
  const result = {
    chunks: raw.chunks.map((chunk) => requireText(chunk, label, 'chunks', SPEAKING_LIMITS.shortTextLength)),
    targetSentence: requireText(raw.targetSentence, label, 'targetSentence', SPEAKING_LIMITS.textLength),
  }
  const pattern = optionalText(raw.pattern, label, 'pattern', SPEAKING_LIMITS.shortTextLength)
  if (pattern !== undefined) result.pattern = pattern
  return result
}

// Prueft und baut die Bibliothek aus festen Feldern neu auf (unbekannte Felder werden verworfen).
export function validateSpeakingLibrary(data) {
  if (!isSpeakingLibraryData(data)) fail(`Keine Sprech-Bibliothek (erwartet: "type": "${SPEAKING_LIBRARY_TYPE}").`)
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(data.schemaVersion)) {
    fail(`Sprech-Bibliothek: schemaVersion ${data.schemaVersion} wird nicht unterstützt (unterstützt: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}).`)
  }
  const libraryId = requireText(data.libraryId, 'Sprech-Bibliothek', 'libraryId', SPEAKING_LIMITS.idLength)
  if (!Number.isInteger(data.libraryVersion) || data.libraryVersion <= 0) fail('Sprech-Bibliothek: "libraryVersion" muss eine positive Ganzzahl sein.')
  const areaId = requireText(data.areaId, 'Sprech-Bibliothek', 'areaId', SPEAKING_LIMITS.idLength)
  if (!Array.isArray(data.exercises) || data.exercises.length < 1 || data.exercises.length > SPEAKING_LIMITS.exercises) {
    fail(`Sprech-Bibliothek: "exercises" muss 1 bis ${SPEAKING_LIMITS.exercises} Einträge enthalten.`)
  }
  if (data.totalExercises !== undefined && data.totalExercises !== data.exercises.length) {
    fail(`Sprech-Bibliothek: "totalExercises" (${data.totalExercises}) passt nicht zur Anzahl der Übungen (${data.exercises.length}).`)
  }

  const seen = new Set()
  const exercises = data.exercises.map((raw, index) => {
    const where = `Übung ${index + 1}`
    if (!isPlainObject(raw)) fail(`${where}: muss ein Objekt sein.`)
    const id = requireText(raw.id, where, 'id', SPEAKING_LIMITS.idLength)
    const label = `${where} (${id})`
    if (seen.has(id)) fail(`${label}: "id" kommt mehrfach vor.`)
    seen.add(id)
    if (!CATEGORY_IDS.includes(raw.category)) fail(`${label}: "category" muss eine von ${CATEGORY_IDS.join(', ')} sein, nicht "${raw.category}".`)
    const base = {
      id,
      category: raw.category,
      topic: requireText(raw.topic, label, 'topic', SPEAKING_LIMITS.titleLength),
      prompt: requireText(raw.prompt, label, 'prompt', SPEAKING_LIMITS.textLength),
      modelAnswer: requireText(raw.modelAnswer, label, 'modelAnswer', SPEAKING_LIMITS.textLength),
      translationDe: requireText(raw.translationDe, label, 'translationDe', SPEAKING_LIMITS.textLength),
      keywords: validateKeywords(raw.keywords, label),
    }
    if (raw.category === 'role_play') return { ...base, ...validateRolePlay(raw, label) }
    if (raw.category === 'graph_description') return { ...base, ...validateGraph(raw, label) }
    if (raw.category === 'sentence_builder') return { ...base, ...validateSentenceBuilder(raw, label) }
    return base
  })
  const title = optionalText(data.title, 'Sprech-Bibliothek', 'title', SPEAKING_LIMITS.titleLength)
  return { type: SPEAKING_LIBRARY_TYPE, schemaVersion: data.schemaVersion, libraryId, libraryVersion: data.libraryVersion, areaId, ...(title === undefined ? {} : { title }), exercises }
}

// Uebungen eines Bereichs in Dateireihenfolge.
export function getSpeakingExercises(entry, categoryId) {
  return entry?.library?.exercises.filter((exercise) => exercise.category === categoryId) ?? []
}

// ---- Audio (Musterantwort als Aufnahme) ----
// Gesprochen wird genau die englische Musterantwort: Antwort bzw. Zielsatz, beim Role Play alle Redebeitraege in
// Reihenfolge. Die Aufnahme gehoert zur Musterantwort und wird erst mit ihr angeboten (nie vorab).
export function speakingSpokenText(exercise) {
  if (exercise.turns) return exercise.turns.map((turn) => turn.text).join('\n')
  if (exercise.chunks) return exercise.targetSentence
  return exercise.modelAnswer
}

// Adapter auf die vorhandene Audio-Logik (audioKeys.js): Als "Loesung" eines Auswahl-Items ergibt der Sprechtext
// denselben Dateinamen, den App UND Generator berechnen (<areaId>__<id>__s__<hash8>.mp3). Aendert sich der Text,
// findet die App kein altes Audio mehr, statt falsch zu sprechen.
export function speakingAudioItem(exercise, areaId) {
  return { areaId, id: exercise.id, itemId: exercise.id, type: 'choice', correctAnswer: speakingSpokenText(exercise) }
}

// Englische Musterantwort in einzelne Saetze (fuer die Argumente der Diskussionsfragen).
export function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)
}

// Stabile, aber gemischte Reihenfolge der Satzbausteine (je Uebung gleich, nie die Zielreihenfolge).
export function shuffleChunks(exercise) {
  const count = exercise.chunks.length
  let seed = 0
  for (const char of exercise.id) seed = (seed * 31 + char.charCodeAt(0)) >>> 0
  const order = Array.from({ length: count }, (_, index) => index)
  for (let index = count - 1; index > 0; index--) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const other = seed % (index + 1)
    ;[order[index], order[other]] = [order[other], order[index]]
  }
  // Ist die Mischung zufaellig die Zielreihenfolge, wird um eins weitergedreht.
  if (count > 1 && order.every((value, index) => value === index)) order.push(order.shift())
  return order
}
