// Gemeinsame, NEUTRALE Test-Helfer fuer den Lerncoach (keine echten Lerninhalte, keine Test-Datei).
export function coachLibraryData(overrides = {}) {
  return {
    type: 'businessEnglishCoach',
    schemaVersion: 1,
    libraryId: 'test-coach-v1',
    libraryVersion: 1,
    areaId: 'w3-lerncoach',
    areaTitle: 'Test Coach',
    units: [{
      unitId: 'u1',
      unitTitle: 'Test Unit',
      level: 'B1',
      estimatedMinutes: 5,
      goal: 'Test-Ziel.',
      steps: [
        { stepId: 't-explain', type: 'explain', title: 'Erklärung', paragraphs: ['Absatz eins.'], pattern: 'A + B', caution: 'Achtung-Hinweis.' },
        { stepId: 't-examples', type: 'examples', title: 'Hören', examples: [
          { exampleId: 't-ex-1', en: 'The test passes today.', de: 'Der Test besteht heute.' },
          { exampleId: 't-ex-2', en: 'The build fails sometimes.', de: 'Der Build scheitert manchmal.', level: 'B2-Ausblick', note: 'Hinweis' },
        ] },
        { stepId: 't-choice', type: 'choice', prompt: 'Which sentence is correct?', options: ['Right sentence one.', 'WRONG-OPTION-A sentence.', 'WRONG-OPTION-B sentence.'], correctAnswer: 'Right sentence one.', explanation: 'ERKLAERUNG-CHOICE.' },
        { stepId: 't-gap', type: 'gap', prompt: 'Complete the sentence: "The test ___ today."', acceptedAnswers: ['passes'], explanation: 'ERKLAERUNG-GAP.' },
        { stepId: 't-produce', type: 'produce', prompt: 'Schreibe einen Satz.', checklist: ['Punkt eins.', 'Punkt zwei.'], modelAnswers: ['Model sentence one.', 'Wrong-ish second model.'], feedback: 'FEEDBACK-PRODUCE.' },
        { stepId: 't-recap', type: 'recap', title: 'Fazit', points: ['Punkt A.'], recommendation: 'Morgen wiederholen.' },
      ],
    }],
    ...overrides,
  }
}

export function jsonFile(data, name = 'coach.json') {
  return new File([JSON.stringify(data)], name, { type: 'application/json' })
}

// Tiefe Kopie mit Aenderung an einem Schritt (zum Testen von Versionswechseln).
export function withStep(data, stepId, change) {
  const copy = JSON.parse(JSON.stringify(data))
  const step = copy.units[0].steps.find((candidate) => candidate.stepId === stepId)
  Object.assign(step, change)
  return copy
}
