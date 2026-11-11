// Neutrale Test-Helfer fuer die lokale Speicherung privater JSON-Bibliotheken (Auftrag 089).
// Ausschliesslich kuenstliche Demo-Inhalte; keine echten oder privaten Lerntexte.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

export function quizData({ areaId = 'test-area', areaTitle = 'Test Area', libraryId = 'quiz-test', libraryVersion = 1, prompt = 'Demo question A?' } = {}) {
  return {
    type: 'businessEnglishLibrary',
    schemaVersion: 1,
    libraryId,
    libraryVersion,
    areaId,
    areaTitle,
    lessons: [{ lessonId: 'l1', lessonTitle: 'Lesson 1', scenarios: [{ scenarioId: 's1', scenarioTitle: 'Scenario 1', items: [
      { itemId: 'item-a', type: 'choice', prompt, options: ['Yes', 'No'], correctAnswer: 'Yes', explanation: 'Demo explanation.' },
    ] }] }],
  }
}

export const jsonText = (data) => JSON.stringify(data)

export function fileOf(data, name = 'demo-library.json') {
  return new File([typeof data === 'string' ? data : JSON.stringify(data)], name, { type: 'application/json' })
}

// Frische, leere Browser-Datenbank (simuliert z. B. vom System entfernten Speicher).
export function resetIndexedDb() {
  globalThis.indexedDB = new IDBFactory()
}

export function freshEnvironment() {
  window.localStorage.clear()
  resetIndexedDb()
}

export function quotaError() {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError')
}
