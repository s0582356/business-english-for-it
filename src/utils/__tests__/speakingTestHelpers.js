// Neutrale Test-Helfer fuer die Sprech-Bibliothek (kuenstliche Demo-Texte, keine echten Lerninhalte).
export function speakingData(overrides = {}) {
  const keywords = [{ term: 'demo term', de: 'Demo-Begriff' }, { term: 'second term' }]
  const exercises = [
    { id: 'es-1', category: 'easy_speaking', topic: 'Demo topic', sourceType: 'moodle', prompt: 'Demo question one?', modelAnswer: 'Demo answer one.', translationDe: 'Demo-Übersetzung eins.', keywords },
    { id: 'es-2', category: 'easy_speaking', topic: 'Demo topic', prompt: 'Demo question two?', modelAnswer: 'Demo answer two.', translationDe: 'Demo-Übersetzung zwei.', keywords: [] },
    { id: 'es-3', category: 'easy_speaking', topic: 'Demo topic', prompt: 'Demo question three?', modelAnswer: 'Demo answer three.', translationDe: 'Demo-Übersetzung drei.', keywords },
    {
      id: 'rp-1', category: 'role_play', topic: 'Demo topic', prompt: 'Situation: demo role play.', roles: { A: 'Clerk', B: 'Customer' },
      turns: [{ speaker: 'A', text: 'Demo line from A.', de: 'Demo-Zeile von A.' }, { speaker: 'B', text: 'Demo line from B.', de: 'Demo-Zeile von B.' }],
      modelAnswer: 'A: "Demo line from A."\nB: "Demo line from B."', translationDe: 'A: Demo\nB: Demo', keywords,
    },
    { id: 'bd-1', category: 'business_discussion', topic: 'Demo topic', prompt: 'Demo discussion question?', modelAnswer: 'First argument. Second argument. Third argument.', translationDe: 'Erstes. Zweites. Drittes.', keywords },
    {
      id: 'gd-1', category: 'graph_description', topic: 'Graph Description', prompt: 'Describe the demo chart.', modelAnswer: 'Demo chart answer.', translationDe: 'Demo-Diagrammantwort.', keywords,
      chartData: { chartType: 'line chart', timeframe: 'Jan to Dec', metric: 'Demo metric (EUR)', values: 'Jan: 10,000, Jun: 25,000, Dec: 45,000' },
    },
    {
      id: 'gd-2', category: 'graph_description', topic: 'Graph Description', prompt: 'Describe the demo pie.', modelAnswer: 'Demo pie answer.', translationDe: 'Demo-Kreis.', keywords,
      chartData: { chartType: 'pie chart', timeframe: 'Year', metric: 'Share (%)', values: 'Alpha: 60%, Beta: 40%' },
    },
    {
      id: 'sb-1', category: 'sentence_builder', topic: 'Demo grammar', prompt: 'Put the chunks in order.', chunks: ['If it rains,', 'we stay', 'at home.'], targetSentence: 'If it rains, we stay at home.',
      pattern: 'If + present, will + infinitive', modelAnswer: 'If it rains, we stay at home.', translationDe: 'Wenn es regnet, bleiben wir zu Hause.', keywords,
    },
  ]
  return {
    type: 'businessEnglishEasySpeaking',
    schemaVersion: 1,
    libraryId: 'demo-speaking-v1',
    libraryVersion: 1,
    areaId: 'demo-speaking',
    title: 'Demo Speaking',
    totalExercises: exercises.length,
    exercises,
    ...overrides,
  }
}
