// Gemeinsame, reine Sprechtext-Ableitung fuer Audio (App UND Generator).
//
// getSpokenTexts(item) -> { question, solution }
//   - question: immer ohne Loesung (nur der Prompt, Luecken als Sprechpause)
//   - solution: nur die RICHTIGE Loesung, oder null wenn es keinen sinnvollen
//     gesprochenen Loesungstext gibt (z. B. Ordered-Strukturliste)
//
// Sicherheitsregel: Falsche Choice-Optionen, Erklaerungen, memoryHint und
// stepFeedback werden hier NIE gelesen und koennen daher nie ins Audio gelangen.
//
// Steuerzeichen im Sprechtext (fuer den Generator):
//   SPEECH_BLANK  '…'  = Luecke -> kurze Sprechpause
//   SPEECH_BREAK  '\n' = Dialogzeilen-Grenze -> Sprechpause
// Der Text darf keine Node-/Browser-spezifischen APIs benoetigen.

export const SPEECH_BLANK = '…'
export const SPEECH_BREAK = '\n'

const BLANK_PATTERN = /_{2,}/
const DOUBLE_QUOTE_PATTERN = /["“”„]/g

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function collapse(text) {
  return text.replace(/\s+/g, ' ').trim()
}

// Satzzeichen direkt an das Vorwort ziehen ("… ." -> "…."), Doppelleerzeichen weg.
function tidy(text) {
  return collapse(text).replace(/\s+([.,;:!?])/g, '$1')
}

function speakablePrompt(prompt) {
  if (!isNonEmptyString(prompt)) return null
  const withPauses = prompt.replace(DOUBLE_QUOTE_PATTERN, '').replace(/_{2,}/g, ` ${SPEECH_BLANK} `)
  return tidy(withPauses)
}

// Rekonstruiert den vollstaendigen Satz aus dem Zitat, das die Luecke enthaelt.
// Fehlt ein Zitat, wird ersatzweise der Prompt ohne die einleitende Aufgaben-
// anweisung ("Complete the sentence:") verwendet (flag) - die Anweisung ist kein
// Teil des Loesungssatzes.
function reconstructGapSolution(item) {
  const answer = Array.isArray(item.acceptedAnswers) ? item.acceptedAnswers[0] : null
  if (!isNonEmptyString(item.prompt) || !isNonEmptyString(answer)) return { text: null, flags: ['gap-unreconstructable'] }

  const quoted = [...item.prompt.matchAll(/["“]([^"”]*)["”]/g)].map((match) => match[1]).find((segment) => BLANK_PATTERN.test(segment))
  const source = quoted ?? item.prompt.replace(/^\s*Complete the [a-z -]{1,30}:\s*/i, '')
  const flags = quoted === undefined ? ['gap-no-quote-fallback'] : []

  const blankCount = (source.match(/_{2,}/g) ?? []).length
  if (blankCount !== 1) return { text: null, flags: ['gap-unreconstructable'] }
  return { text: tidy(source.replace(BLANK_PATTERN, answer.trim())), flags }
}

function endsLikeSentence(label) {
  return /[.!?…]["')\]]*$/.test(label.trim())
}

// Anrede ("Dear Sir or Madam,", "Hi Sarah,") und Gruss ("Yours sincerely,") sind woertlicher
// E-Mail-Text und damit sprechbare Zeilen. Beschreibende Labels wie
// "Sign-off (e.g. 'Yours sincerely,')" sind es nicht (enden nicht auf Komma).
const SALUTATION_LINE = /^(?:Dear|Hi|Hello)\b[^.!?]*,$/
const SIGN_OFF_LINE = /(?:^|[.!?]\s+)(?:Yours (?:sincerely|faithfully)|(?:Kind|Best|Warm) regards|Best wishes|Regards),$/i

export function isSpokenLine(label) {
  const text = label.trim()
  return endsLikeSentence(text) || SALUTATION_LINE.test(text) || SIGN_OFF_LINE.test(text)
}

function orderedDialogSolution(item) {
  if (!Array.isArray(item.steps) || !Array.isArray(item.correctOrder) || item.correctOrder.length === 0) return null
  const byId = new Map(item.steps.map((step) => [step.id, step.label]))
  const labels = item.correctOrder.map((id) => byId.get(id))
  if (!labels.every(isNonEmptyString)) return null
  // Dialog/Satzfolge nur, wenn JEDE Zeile gesprochener Text ist (Satz, Anrede oder Gruss). Strukturlisten wie
  // "Subject line / Salutation / ..." bekommen bewusst keine Loesungs-Audio.
  if (!labels.every(isSpokenLine)) return null
  return labels.map(collapse).join(SPEECH_BREAK)
}

// Fuer QA-Berichte: zusaetzlich zu den Texten die Hinweise (flags).
export function describeSpokenTexts(item) {
  if (!item || typeof item !== 'object') return { question: null, solution: null, flags: [] }

  if (item.type === 'choice') {
    return {
      question: speakablePrompt(item.prompt),
      solution: isNonEmptyString(item.correctAnswer) ? collapse(item.correctAnswer) : null,
      flags: [],
    }
  }

  if (item.type === 'gap') {
    const { text, flags } = reconstructGapSolution(item)
    return { question: speakablePrompt(item.prompt), solution: text, flags }
  }

  if (item.type === 'ordered') {
    const solution = orderedDialogSolution(item)
    return { question: speakablePrompt(item.prompt), solution, flags: solution === null ? ['ordered-structure-no-solution'] : [] }
  }

  return { question: null, solution: null, flags: [] }
}

export function getSpokenTexts(item) {
  const { question, solution } = describeSpokenTexts(item)
  return { question, solution }
}
