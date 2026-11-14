import { describe, expect, it } from 'vitest'
import { SPEAKING_CATEGORIES, getSpeakingExercises, isSpeakingLibraryData, shuffleChunks, splitSentences, validateSpeakingLibrary } from '../speakingLibrary.js'
import { buildSpeakingChart, parseChartValues } from '../speakingChart.js'
import { loadSpeakingProgress, saveSpeakingProgress, withSpeakingStatus } from '../speakingProgress.js'
import { speakingData } from './speakingTestHelpers.js'

describe('validateSpeakingLibrary', () => {
  it('akzeptiert die Demo-Bibliothek und behaelt alle Felder je Bereich', () => {
    const library = validateSpeakingLibrary(speakingData())
    expect(library.exercises).toHaveLength(8)
    expect(SPEAKING_CATEGORIES.map((category) => getSpeakingExercises({ library }, category.id).length)).toEqual([3, 1, 1, 2, 1])
    expect(library.exercises.find((exercise) => exercise.id === 'rp-1').turns).toHaveLength(2)
    expect(library.exercises.find((exercise) => exercise.id === 'sb-1').chunks).toHaveLength(3)
    expect(library.exercises.find((exercise) => exercise.id === 'es-1').keywords[1]).toEqual({ term: 'second term' })
  })

  it('verwirft unbekannte Felder', () => {
    const data = speakingData()
    data.exercises[0].evil = '<img onerror=alert(1)>'
    expect(validateSpeakingLibrary(data).exercises[0]).not.toHaveProperty('evil')
  })

  it('erkennt den Dateityp', () => {
    expect(isSpeakingLibraryData(speakingData())).toBe(true)
    expect(isSpeakingLibraryData({ type: 'businessEnglishPractice' })).toBe(false)
    expect(isSpeakingLibraryData(null)).toBe(false)
  })

  it.each([
    ['falsche schemaVersion', (data) => { data.schemaVersion = 9 }, /schemaVersion/],
    ['keine libraryVersion', (data) => { data.libraryVersion = 0 }, /libraryVersion/],
    ['doppelte ID', (data) => { data.exercises[1].id = 'es-1' }, /mehrfach/],
    ['unbekannter Bereich', (data) => { data.exercises[0].category = 'karaoke' }, /category/],
    ['fehlende Musterantwort', (data) => { delete data.exercises[0].modelAnswer }, /modelAnswer/],
    ['falsche Gesamtzahl', (data) => { data.totalExercises = 99 }, /totalExercises/],
    ['Redebeitrag ohne Rolle', (data) => { data.exercises[3].turns[0].speaker = 'Z' }, /speaker/],
    ['Diagramm ohne Werte', (data) => { delete data.exercises[5].chartData.values }, /chartData\.values/],
    ['Satzbausteine fehlen', (data) => { data.exercises[7].chunks = ['nur einer'] }, /chunks/],
    ['keine Uebungen', (data) => { data.exercises = []; delete data.totalExercises }, /exercises/],
  ])('lehnt ab: %s', (_name, mutate, message) => {
    const data = speakingData()
    mutate(data)
    expect(() => validateSpeakingLibrary(data)).toThrow(message)
  })
})

describe('Sentence-Builder- und Argument-Helfer', () => {
  it('mischt die Bausteine stabil und nie in Zielreihenfolge', () => {
    const exercise = validateSpeakingLibrary(speakingData()).exercises.find((entry) => entry.id === 'sb-1')
    const order = shuffleChunks(exercise)
    expect([...order].sort()).toEqual([0, 1, 2])
    expect(order).not.toEqual([0, 1, 2])
    expect(shuffleChunks(exercise)).toEqual(order)
  })

  it('teilt eine Antwort in Saetze', () => {
    expect(splitSentences('One idea. Two ideas! Three?')).toEqual(['One idea.', 'Two ideas!', 'Three?'])
  })
})

describe('buildSpeakingChart', () => {
  const chart = (chartType, values, extra = {}) => buildSpeakingChart({ chartType, timeframe: 'Jan to Dec', metric: 'Demo (EUR)', values, ...extra })

  it('Tausenderkommas und Zeitpunkte: Linie', () => {
    const result = chart('line chart', 'Jan: 10,000, Jun: 25,000, Dec: 45,000')
    expect(result).toMatchObject({ kind: 'line', chartType: 'line', categories: ['Jan', 'Jun', 'Dec'], unit: 'EUR' })
    expect(result.series[0].values).toEqual([10000, 25000, 45000])
  })

  it('k/M-Endungen, negative Werte und Einheiten in der Achse', () => {
    expect(chart('line chart', 'Jan: 50k, Jul: -5k').series[0].values).toEqual([50000, -5000])
    expect(chart('bar chart', '2024: 1.2M EUR, 2025: 2.4M EUR').series[0].values).toEqual([1200000, 2400000])
    expect(buildSpeakingChart({ chartType: 'bar chart', timeframe: '2020 to 2025', metric: 'Revenue (EUR millions)', values: 'Online: 2M to 8M' }).series[0].values).toEqual([2, 8])
  })

  it('"A to B" je Reihe: eine Reihe pro Eintrag ueber den Zeitraum', () => {
    const result = chart('line chart', 'Mobile: 35% to 70%, Desktop: 65% to 30%', { timeframe: '2020 to 2025' })
    expect(result.categories).toEqual(['2020', '2025'])
    expect(result.series.map((series) => [series.name, series.values])).toEqual([['Mobile', [35, 70]], ['Desktop', [65, 30]]])
  })

  it('Bereich "60-90%" zaehlt als hoechster Wert, konstante Werte ergeben eine waagerechte Linie', () => {
    expect(chart('line chart', 'Mon-Fri: 60-90%, Sat-Sun: 15%').series[0].values).toEqual([90, 15])
    expect(chart('line chart', 'Constant 4.5% across period').series[0].values).toEqual([4.5, 4.5])
  })

  it('Linie mit nicht-zeitlichen Beschriftungen wird als Balken gezeichnet', () => {
    expect(chart('line chart', 'Team Dev: +45%, Team Support: +10%').kind).toBe('bar')
  })

  it('Kreisdiagramm: Anteile', () => {
    const result = chart('pie chart', 'Cloud: 60%, Consulting: 25%, Licenses: 15%')
    expect(result.kind).toBe('pie')
    expect(result.slices.map((slice) => slice.value)).toEqual([60, 25, 15])
  })

  it('ohne Zahlen: keine Zeichnung, aber kein Absturz', () => {
    expect(chart('line chart', 'rising steadily')).toBeNull()
    expect(parseChartValues('A: 1, B: 2')).toHaveLength(2)
  })
})

describe('speakingProgress', () => {
  it('speichert und laedt je Bibliothek, ignoriert ungueltige Eintraege', () => {
    window.localStorage.clear()
    expect(loadSpeakingProgress('lib-a')).toEqual({})
    let progress = withSpeakingStatus({}, 'x1', 'mastered')
    progress = withSpeakingStatus(progress, 'x2', 'practice')
    expect(saveSpeakingProgress('lib-a', progress)).toBe(true)
    expect(loadSpeakingProgress('lib-a')).toEqual({ x1: 'mastered', x2: 'practice' })
    expect(loadSpeakingProgress('lib-b')).toEqual({})
    expect(withSpeakingStatus(progress, 'x1', null)).toEqual({ x2: 'practice' })
    window.localStorage.setItem('businessEnglishSpeakingProgress:v1', JSON.stringify({ schemaVersion: 1, libraries: { 'lib-a': { x1: 'wild', x2: 'practice' } } }))
    expect(loadSpeakingProgress('lib-a')).toEqual({ x2: 'practice' })
  })

  it('beschaedigter Speicher fuehrt zu leerem Stand', () => {
    window.localStorage.setItem('businessEnglishSpeakingProgress:v1', '{kaputt')
    expect(loadSpeakingProgress('lib-a')).toEqual({})
  })
})
