// Gemeinsamer, bewusst schlanker Item-Rahmen für private Lernpakete.
//
// Ebenen sauber getrennt:
// - "type" ist ausschliesslich der technische Renderer ("choice" | "ordered").
// - "intent" ist die didaktische Absicht (z. B. "telephone-opening") und wird
//   nicht technisch ausgewertet - reines Anzeige-/Ordnungsmerkmal.
// - "category" ist der Lernbereich (z. B. "Business Telephoning").
//
// Kein Universalschema: jeder Typ hat einen eigenen, kleinen Validator.

export const SUPPORTED_TYPES = ['choice', 'ordered']

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function validateCommonFields(item, index) {
  if (!item || typeof item !== 'object') {
    throw new Error(`Item ${index + 1}: muss ein Objekt sein.`)
  }
  if (!SUPPORTED_TYPES.includes(item.type)) {
    throw new Error(
      `Item ${index + 1}: "type" muss "${SUPPORTED_TYPES.join('" oder "')}" sein, nicht "${item.type}".`,
    )
  }
  if (item.intent !== undefined && !isNonEmptyString(item.intent)) {
    throw new Error(`Item ${index + 1}: "intent" muss ein nicht-leerer Text sein, falls angegeben.`)
  }
  if (item.category !== undefined && !isNonEmptyString(item.category)) {
    throw new Error(`Item ${index + 1}: "category" muss ein nicht-leerer Text sein, falls angegeben.`)
  }
}

function validateMemoryHint(memoryHint, index) {
  if (memoryHint === undefined || memoryHint === null) return null
  if (typeof memoryHint !== 'object') {
    throw new Error(`Item ${index + 1}: "memoryHint" muss ein Objekt sein, falls angegeben.`)
  }
  const { whyItFits, memoryHook } = memoryHint
  if (whyItFits !== undefined && typeof whyItFits !== 'string') {
    throw new Error(`Item ${index + 1}: "memoryHint.whyItFits" muss ein Text sein, falls angegeben.`)
  }
  if (memoryHook !== undefined && typeof memoryHook !== 'string') {
    throw new Error(`Item ${index + 1}: "memoryHint.memoryHook" muss ein Text sein, falls angegeben.`)
  }
  if (!isNonEmptyString(whyItFits) && !isNonEmptyString(memoryHook)) return null
  return {
    whyItFits: isNonEmptyString(whyItFits) ? whyItFits : null,
    memoryHook: isNonEmptyString(memoryHook) ? memoryHook : null,
  }
}

function validateChoiceItem(item, index) {
  if (!isNonEmptyString(item.prompt)) {
    throw new Error(`Item ${index + 1} (choice): "prompt" fehlt oder ist ungültig.`)
  }
  if (!Array.isArray(item.options) || item.options.length < 2 || !item.options.every(isNonEmptyString)) {
    throw new Error(`Item ${index + 1} (choice): "options" muss mindestens zwei Texte enthalten.`)
  }
  if (!isNonEmptyString(item.correctAnswer)) {
    throw new Error(`Item ${index + 1} (choice): "correctAnswer" fehlt oder ist ungültig.`)
  }
  if (!item.options.includes(item.correctAnswer)) {
    throw new Error(`Item ${index + 1} (choice): "correctAnswer" muss in "options" enthalten sein.`)
  }
  if (!isNonEmptyString(item.explanation)) {
    throw new Error(`Item ${index + 1} (choice): "explanation" fehlt oder ist ungültig.`)
  }

  return {
    id: isNonEmptyString(item.id) ? item.id : `choice-${index + 1}`,
    type: 'choice',
    intent: item.intent ?? null,
    category: item.category ?? null,
    prompt: item.prompt,
    options: [...item.options],
    correctAnswer: item.correctAnswer,
    explanation: item.explanation,
    memoryHint: validateMemoryHint(item.memoryHint, index),
  }
}

function validateOrderedItem(item, index) {
  if (!isNonEmptyString(item.prompt)) {
    throw new Error(`Item ${index + 1} (ordered): "prompt" fehlt oder ist ungültig.`)
  }
  if (!Array.isArray(item.steps) || item.steps.length < 2) {
    throw new Error(`Item ${index + 1} (ordered): "steps" muss mindestens zwei Schritte enthalten.`)
  }
  item.steps.forEach((step, stepIndex) => {
    if (!step || !isNonEmptyString(step.id) || !isNonEmptyString(step.label)) {
      throw new Error(`Item ${index + 1} (ordered): Schritt ${stepIndex + 1} braucht "id" und "label".`)
    }
  })
  const stepIds = item.steps.map((step) => step.id)
  if (new Set(stepIds).size !== stepIds.length) {
    throw new Error(`Item ${index + 1} (ordered): Schritt-IDs müssen eindeutig sein.`)
  }
  if (
    !Array.isArray(item.correctOrder)
    || item.correctOrder.length !== stepIds.length
    || new Set(item.correctOrder).size !== stepIds.length
    || !item.correctOrder.every((id) => stepIds.includes(id))
  ) {
    throw new Error(`Item ${index + 1} (ordered): "correctOrder" muss genau eine Permutation der Schritt-IDs sein.`)
  }
  if (item.explanation !== undefined && !isNonEmptyString(item.explanation)) {
    throw new Error(`Item ${index + 1} (ordered): "explanation" muss ein Text sein, falls angegeben.`)
  }

  let stepFeedback = null
  if (item.stepFeedback !== undefined && item.stepFeedback !== null) {
    if (typeof item.stepFeedback !== 'object') {
      throw new Error(`Item ${index + 1} (ordered): "stepFeedback" muss ein Objekt sein, falls angegeben.`)
    }
    for (const [stepId, text] of Object.entries(item.stepFeedback)) {
      if (!stepIds.includes(stepId) || !isNonEmptyString(text)) {
        throw new Error(`Item ${index + 1} (ordered): "stepFeedback" enthält einen ungültigen Eintrag.`)
      }
    }
    stepFeedback = { ...item.stepFeedback }
  }

  return {
    id: isNonEmptyString(item.id) ? item.id : `ordered-${index + 1}`,
    type: 'ordered',
    intent: item.intent ?? null,
    category: item.category ?? null,
    prompt: item.prompt,
    steps: item.steps.map((step) => ({ id: step.id, label: step.label })),
    correctOrder: [...item.correctOrder],
    explanation: isNonEmptyString(item.explanation) ? item.explanation : null,
    stepFeedback,
  }
}

export function validateItem(item, index) {
  validateCommonFields(item, index)
  if (item.type === 'choice') return validateChoiceItem(item, index)
  return validateOrderedItem(item, index)
}

export function validateContentPackage(data) {
  if (!Array.isArray(data)) {
    throw new Error('Die JSON-Datei muss ein Array von Lern-Items enthalten.')
  }
  if (data.length === 0) {
    throw new Error('Die JSON-Datei enthält keine Lern-Items.')
  }
  return data.map((item, index) => validateItem(item, index))
}
