import { describe, expect, it } from 'vitest'
import { FIGURE_LIMITS, findUnmatchedBindings, getFigureForItem, isFigureLibraryData, validateFigureLibrary } from '../figureLibrary.js'
import { figureData, figureDataV2, speakingData, withFigure } from './figureTestHelpers.js'

const reason = (data) => { try { validateFigureLibrary(data) } catch (error) { return error.message } return null }

describe('Figuren-Bibliothek: Validierung', () => {
  it('erkennt den Typ und akzeptiert eine gueltige Datei', () => {
    expect(isFigureLibraryData(figureData())).toBe(true)
    expect(isFigureLibraryData({ type: 'businessEnglishLibrary' })).toBe(false)
    expect(isFigureLibraryData(null)).toBe(false)
    expect(isFigureLibraryData([])).toBe(false)
    const library = validateFigureLibrary(figureData())
    expect(library.figures).toHaveLength(2)
    expect(library.bindings).toHaveLength(2)
  })

  it('lehnt falschen Typ, falsche schemaVersion und fehlende Kopfdaten mit deutscher Meldung ab', () => {
    expect(reason({ ...figureData(), type: 'x' })).toContain('Keine Figuren-Bibliothek')
    expect(reason({ ...figureData(), schemaVersion: 3 })).toContain('schemaVersion 3')
    expect(reason({ ...figureData(), libraryId: '' })).toContain('libraryId')
    expect(reason({ ...figureData(), libraryVersion: 0 })).toContain('libraryVersion')
    expect(reason({ ...figureData(), libraryVersion: 1.5 })).toContain('libraryVersion')
    expect(reason({ ...figureData(), areaId: ' ' })).toContain('areaId')
  })

  it('lehnt doppelte figureId, unbekannten chartType und fehlende Pflichtfelder ab', () => {
    const data = figureData()
    expect(reason({ ...data, figures: [data.figures[0], { ...data.figures[1], figureId: 'fig-line' }] })).toContain('mehrfach')
    expect(reason(withFigure(data, { chartType: 'pie' }))).toContain('chartType')
    for (const field of ['title', 'xAxisLabel', 'yAxisLabel', 'unit', 'textAlternative', 'figureId']) {
      expect(reason(withFigure(data, { [field]: '' })), field).toContain(field)
    }
  })

  it('verlangt zu jeder Kategorie genau einen endlichen Zahlenwert je Reihe', () => {
    const data = figureData()
    const bad = (values) => withFigure(data, { series: [{ name: 'A', values }] })
    expect(reason(bad([1, 2]))).toContain('genau 3 Werte')
    expect(reason(bad([1, 2, 3, 4]))).toContain('genau 3 Werte')
    expect(reason(bad([1, 2, NaN]))).toContain('endliche Zahlen')
    expect(reason(bad([1, 2, Infinity]))).toContain('endliche Zahlen')
    expect(reason(bad([1, 2, '3']))).toContain('endliche Zahlen')
    expect(reason(bad([1, 2, null]))).toContain('endliche Zahlen')
    expect(reason(bad([1, 2, 1e12]))).toContain('endliche Zahlen')
    expect(reason(withFigure(data, { series: [{ name: 'A', values: [1, 2, 3] }, { name: 'A', values: [1, 2, 3] }] }))).toContain('mehrfach')
  })

  it('begrenzt Kategorien, Reihen, Figuren, Bindungen und Textlaengen', () => {
    const data = figureData()
    const many = Array.from({ length: FIGURE_LIMITS.categories + 1 }, (_, index) => `C${index}`)
    expect(reason(withFigure(data, { categories: many, series: [{ name: 'A', values: many.map(() => 1) }] }))).toContain('categories')
    const manySeries = Array.from({ length: FIGURE_LIMITS.series + 1 }, (_, index) => ({ name: `S${index}`, values: [1, 2, 3] }))
    expect(reason(withFigure(data, { series: manySeries }))).toContain('series')
    expect(reason(withFigure(data, { title: 'x'.repeat(FIGURE_LIMITS.titleLength + 1) }))).toContain('zu lang')
    expect(reason(withFigure(data, { textAlternative: 'x'.repeat(FIGURE_LIMITS.textAlternativeLength + 1) }))).toContain('zu lang')
    const manyFigures = Array.from({ length: FIGURE_LIMITS.figures + 1 }, (_, index) => ({ ...data.figures[0], figureId: `f${index}` }))
    expect(reason({ ...data, figures: manyFigures })).toContain('figures')
    expect(reason({ ...data, figures: [], bindings: [] })).toContain('figures')
  })

  it('verlangt fuer ein Liniendiagramm mindestens zwei Kategorien', () => {
    expect(reason(withFigure(figureData(), { categories: ['S1'], series: [{ name: 'A', values: [1] }] }))).toContain('mindestens 2')
    expect(reason(withFigure(figureData(), { chartType: 'bar', categories: ['S1'], series: [{ name: 'A', values: [1] }] }, 0))).toBeNull()
  })

  it('prueft Bindungen: unbekannte Figur, fremder Bereich, doppelt gebundene Aufgabe, fehlende Felder', () => {
    const data = figureData()
    expect(reason({ ...data, bindings: [{ areaId: 'test-area', itemId: 'item-a', figureId: 'gibt-es-nicht' }] })).toContain('nicht definiert')
    expect(reason({ ...data, bindings: [{ areaId: 'andere', itemId: 'item-a', figureId: 'fig-line' }] })).toContain('weicht')
    expect(reason({ ...data, bindings: [data.bindings[0], { ...data.bindings[1], itemId: 'item-a' }] })).toContain('mehrfach gebunden')
    expect(reason({ ...data, bindings: [{ areaId: 'test-area', figureId: 'fig-line' }] })).toContain('itemId')
    expect(reason({ ...data, bindings: [] })).toContain('bindings')
  })

  it('verwirft unbekannte Felder und fuehrt nichts aus (reine Daten)', () => {
    const data = figureData()
    data.figures[0].onclick = 'alert(1)'
    data.extra = { script: '<script>alert(1)</script>' }
    const library = validateFigureLibrary(data)
    expect(library.figures[0]).not.toHaveProperty('onclick')
    expect(library).not.toHaveProperty('extra')
  })

  it('Texte bleiben unveraendert als Text erhalten (kein Entfernen, keine Auswertung)', () => {
    const library = validateFigureLibrary(withFigure(figureData(), { title: 'A <b>b</b> & c' }))
    expect(library.figures[0].title).toBe('A <b>b</b> & c')
  })
})

describe('Figuren-Bibliothek: Zuordnung', () => {
  const entry = { library: validateFigureLibrary(figureData()) }

  it('liefert die Figur zur Aufgabe, sonst null (Aufgaben ohne Figur bleiben unveraendert)', () => {
    expect(getFigureForItem(entry, 'test-area', 'item-a').figureId).toBe('fig-line')
    expect(getFigureForItem(entry, 'test-area', 'item-b').figureId).toBe('fig-bar')
    expect(getFigureForItem(entry, 'test-area', 'item-ohne')).toBeNull()
    expect(getFigureForItem(entry, 'anderer-bereich', 'item-a')).toBeNull()
    expect(getFigureForItem(null, 'test-area', 'item-a')).toBeNull()
  })

  it('meldet Bindungen auf unbekannte Aufgaben nur, wenn der Bereich geladen ist', () => {
    const quiz = { library: { areaId: 'test-area', lessons: [{ scenarios: [{ items: [{ id: 'item-a' }] }] }] } }
    expect(findUnmatchedBindings(entry, quiz)).toEqual(['item-b'])
    expect(findUnmatchedBindings(entry, undefined)).toEqual([])
    expect(findUnmatchedBindings(null, quiz)).toEqual([])
  })
})

describe('Figuren-Bibliothek: optionales Sprechtraining (Schema 2)', () => {
  const speakingReason = (mutate) => {
    const data = figureDataV2()
    mutate(data.figures[0].speaking)
    return reason(data)
  }

  it('akzeptiert Schema 2 mit und ohne Sprechtraining; die Zahlen bleiben dabei gleich', () => {
    const withSpeaking = validateFigureLibrary(figureDataV2())
    expect(withSpeaking.schemaVersion).toBe(2)
    expect(withSpeaking.figures[0].speaking.sentences).toHaveLength(5)
    expect(withSpeaking.figures[1]).not.toHaveProperty('speaking')
    const plain = validateFigureLibrary(figureData({ schemaVersion: 2 }))
    expect(plain.figures.every((figure) => !('speaking' in figure))).toBe(true)
    expect(withSpeaking.figures[0].series).toEqual(plain.figures[0].series)
    expect(withSpeaking.bindings).toEqual(plain.bindings)
  })

  it('alte Dateien (Schema 1) bleiben gueltig und bekommen kein Sprechtraining', () => {
    const library = validateFigureLibrary(figureData())
    expect(library.schemaVersion).toBe(1)
    expect(library.figures.every((figure) => !('speaking' in figure))).toBe(true)
  })

  it('lehnt "speaking" in Schema 1 ab (klare Meldung statt stillem Verwerfen)', () => {
    const data = figureData()
    data.figures[0].speaking = speakingData()
    expect(reason(data)).toContain('schemaVersion 2')
  })

  it('prueft Aufbau, Rollen, Pflichtfelder, Laengen und eindeutige IDs der Beispielsaetze', () => {
    expect(speakingReason((speaking) => { speaking.sentences = [] })).toContain('speaking.sentences')
    expect(speakingReason((speaking) => { speaking.sentences = speakingData(FIGURE_LIMITS.speakingSentences + 1).sentences })).toContain('speaking.sentences')
    expect(speakingReason((speaking) => { speaking.sentences[0].role = 'poem' })).toContain('role')
    for (const field of ['sentenceId', 'en', 'de', 'note']) expect(speakingReason((speaking) => { speaking.sentences[0][field] = ' ' }), field).toContain(field)
    expect(speakingReason((speaking) => { speaking.sentences[1].sentenceId = 'sp-1' })).toContain('mehrfach')
    expect(speakingReason((speaking) => { speaking.sentences[0].en = 'x'.repeat(FIGURE_LIMITS.sentenceLength + 1) })).toContain('zu lang')
    expect(speakingReason((speaking) => { speaking.sentences[0].note = 'x'.repeat(FIGURE_LIMITS.noteLength + 1) })).toContain('zu lang')
    const notObject = figureDataV2()
    notObject.figures[0].speaking = 'Text'
    expect(reason(notObject)).toContain('muss ein Objekt sein')
  })

  it('verwirft unbekannte Felder der Beispielsaetze und laesst Texte unveraendert', () => {
    const data = figureDataV2()
    data.figures[0].speaking.sentences[0].onclick = 'alert(1)'
    data.figures[0].speaking.sentences[0].en = 'A <b>b</b> & c'
    const sentence = validateFigureLibrary(data).figures[0].speaking.sentences[0]
    expect(sentence).not.toHaveProperty('onclick')
    expect(sentence.en).toBe('A <b>b</b> & c')
  })
})
