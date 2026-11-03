// Gemeinsame, NEUTRALE Test-Helfer fuer Diagramm-Figuren (kuenstliche Demo-Daten, keine echten Lerninhalte).
export function figureData(overrides = {}) {
  return {
    type: 'businessEnglishFigures',
    schemaVersion: 1,
    libraryId: 'test-figures-v1',
    libraryVersion: 1,
    areaId: 'test-area',
    figures: [
      {
        figureId: 'fig-line',
        chartType: 'line',
        title: 'Demo line',
        xAxisLabel: 'Step',
        yAxisLabel: 'Demo value',
        unit: 'units',
        categories: ['S1', 'S2', 'S3'],
        series: [{ name: 'Alpha', values: [3, 7, 5] }, { name: 'Beta', values: [2, 2, 9] }],
        textAlternative: 'Demo-Text: Alpha 3, 7, 5; Beta 2, 2, 9.',
      },
      {
        figureId: 'fig-bar',
        chartType: 'bar',
        title: 'Demo bar',
        xAxisLabel: 'Group',
        yAxisLabel: 'Demo count',
        unit: 'pieces',
        categories: ['G1', 'G2'],
        series: [{ name: 'Gamma', values: [4, 6] }],
        textAlternative: 'Demo-Text: Gamma 4 und 6.',
      },
    ],
    bindings: [
      { areaId: 'test-area', itemId: 'item-a', figureId: 'fig-line' },
      { areaId: 'test-area', itemId: 'item-b', figureId: 'fig-bar' },
    ],
    ...overrides,
  }
}

// Ersetzt Felder der ersten Figur.
export function withFigure(data, patch, index = 0) {
  const figures = data.figures.map((figure, position) => (position === index ? { ...figure, ...patch } : figure))
  return { ...data, figures }
}

// Neutrales Sprechtraining (kuenstliche Demo-Saetze) fuer Schema 2.
export function speakingData(count = 5) {
  const roles = ['introduce', 'initial', 'development', 'key-figures', 'summary']
  return {
    sentences: Array.from({ length: count }, (_, index) => ({
      sentenceId: `sp-${index + 1}`,
      role: roles[index % roles.length],
      en: `Demo sentence ${index + 1} in English.`,
      de: `Demo-Satz ${index + 1} auf Deutsch.`,
      note: `Demo-Erklärung ${index + 1}.`,
    })),
  }
}

// Schema 2 mit Sprechtraining an der ersten Figur.
export function figureDataV2(overrides = {}) {
  const data = figureData({ schemaVersion: 2, libraryVersion: 2 })
  data.figures[0] = { ...data.figures[0], speaking: speakingData() }
  return { ...data, ...overrides }
}
