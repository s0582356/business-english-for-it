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

// Neutrale Bibliothek mit gefuehrtem Schreibtraining (Schritte mit "check"): eigener Satz (Position egal)
// und eine Transferaufgabe (if-Teil am Ende). Alle Musterloesungen erfuellen ihren eigenen Strukturcheck.
export function guidedLibraryData(overrides = {}) {
  const data = coachLibraryData(overrides)
  const steps = data.units[0].steps
  const index = steps.findIndex((step) => step.stepId === 't-produce')
  steps[index] = {
    stepId: 't-produce',
    type: 'produce',
    check: { type: 'conditional-type-1', position: 'any' },
    prompt: 'Schreibe einen Satz über einen Testlauf.',
    checklist: ['Punkt eins.', 'Punkt zwei.'],
    modelAnswers: ['If the test fails, we will stop the release.', 'We will stop the release if the test fails.'],
    feedback: 'FEEDBACK-PRODUCE.',
  }
  steps.splice(index + 1, 0, {
    stepId: 't-transfer',
    type: 'produce',
    variant: 'transfer',
    hint: 'WORT-HINWEIS',
    check: { type: 'conditional-type-1', position: 'end' },
    prompt: 'Transfer: if am Ende.',
    checklist: ['Transfer-Punkt.'],
    modelAnswers: ['We will call you if the server stops.', 'The team will help if you ask.'],
    feedback: 'FEEDBACK-TRANSFER.',
  })
  return data
}
