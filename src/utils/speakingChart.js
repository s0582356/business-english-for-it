// Macht aus den Diagrammdaten einer Graph-Description-Uebung ("chartData": chartType, timeframe, metric, values)
// eine zeichenbare Abbildung. "values" ist freier Text wie "Jan: 10,000, Jun: 25,000" oder "Online: 2M to 8M, Retail: 6M to 4M".
//
// Ergebnis: { kind: 'pie' | 'line' | 'bar', ...} im Format von ChartPlot (line/bar) bzw. { slices } (pie),
// oder null, wenn der Text keine auswertbaren Zahlen enthaelt (dann zeigt die Oberflaeche nur die Datentabelle).

// Zahl mit optionalem Vorzeichen, Tausenderkommas, Dezimalpunkt und k/M-Endung ("10,000", "-5k", "1.2M", "4.5%").
// Ein Bindestrich zwischen Ziffern ("60-90%") ist ein Bereich, kein Vorzeichen.
const NUMBER = /(?:(?<![\w.])([-+])\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?([kKM])(?![A-Za-z]))?/g
const TEMPORAL_LABEL = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun|q[1-4]|y\d|year|week|day|month|spring|summer|autumn|winter|\d{4})/i

// Nennt die Einheit der Achse schon "millions"/"thousands", ist "2M" bzw. "5k" bereits in dieser Einheit gemeint.
function numbersOf(text, unit = '') {
  const inUnit = /million/i.test(unit) ? 'M' : /thousand/i.test(unit) ? 'kK' : ''
  return [...text.matchAll(NUMBER)].map(([, sign, digits, suffix]) => {
    const factor = suffix && inUnit.includes(suffix) ? 1 : suffix === 'M' ? 1e6 : suffix ? 1e3 : 1
    const magnitude = Number.parseFloat(digits.replaceAll(',', '')) * factor
    return sign === '-' ? -magnitude : magnitude
  })
}

// "Jan: 10,000, Jun: 25,000" -> [{ label: 'Jan', text: '10,000', numbers: [10000] }, ...]
// Ohne Doppelpunkt ("Constant 4.5% across period") entsteht ein einzelner Punkt ohne Beschriftung.
export function parseChartValues(values, unit = '') {
  const parts = values.split(/,\s*(?=[^,:]+:)/).map((part) => part.trim()).filter(Boolean)
  return parts.map((part) => {
    const colon = part.indexOf(':')
    const label = colon === -1 ? null : part.slice(0, colon).trim()
    const text = colon === -1 ? part : part.slice(colon + 1).trim()
    return { label, text, numbers: numbersOf(text, unit) }
  })
}

function splitTimeframe(timeframe) {
  const parts = timeframe.split(/\s+to\s+/i).map((part) => part.trim()).filter(Boolean)
  return parts.length === 2 ? parts : ['Start', 'Ende']
}

// "Cloud expenses (EUR)" -> { name: 'Cloud expenses', unit: 'EUR' }; sonst Prozent oder allgemein "Wert".
function splitMetric(metric, valuesText) {
  const match = metric.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (match) return { name: match[1] || metric, unit: match[2] }
  return { name: metric, unit: valuesText.includes('%') ? '%' : 'Wert' }
}

export function buildSpeakingChart(chartData) {
  const { name, unit } = splitMetric(chartData.metric, chartData.values)
  const points = parseChartValues(chartData.values, unit)
  if (points.length === 0 || points.some((point) => point.numbers.length === 0)) return null
  const figure = {
    title: `${chartData.chartType}: ${name}`,
    textAlternative: `${chartData.chartType}, ${chartData.timeframe}. ${chartData.metric}: ${chartData.values}.`,
    xAxisLabel: chartData.timeframe,
    yAxisLabel: name,
    unit,
  }

  if (/pie/i.test(chartData.chartType)) {
    const slices = points.map((point) => ({ label: point.label ?? chartData.metric, text: point.text, value: point.numbers[0] })).filter((slice) => slice.value > 0)
    return slices.length > 0 ? { ...figure, kind: 'pie', slices } : null
  }

  const kind = /bar/i.test(chartData.chartType) ? 'bar' : 'line'
  // Jede Reihe von "A to B": zwei Werte (Anfang und Ende des Zeitraums), eine Reihe je Eintrag.
  if (points.every((point) => point.label && point.numbers.length === 2 && /\bto\b/i.test(point.text))) {
    return { ...figure, kind, chartType: kind, categories: splitTimeframe(chartData.timeframe), series: points.map((point) => ({ name: point.label, values: point.numbers })) }
  }
  // Ein konstanter Wert ohne Beschriftung gilt fuer den ganzen Zeitraum.
  if (points.length === 1 && !points[0].label) {
    const value = points[0].numbers[0]
    return { ...figure, kind, chartType: kind, categories: splitTimeframe(chartData.timeframe), series: [{ name, values: [value, value] }] }
  }
  // Ein Wert je Beschriftung. Eine Linie nur, wenn die Beschriftungen Zeitpunkte sind; sonst Balken
  // (eine Linie zwischen "Team Dev" und "Team Support" waere irrefuehrend). Bei Bereichen ("60-90%") zaehlt der hoechste Wert.
  const temporal = points.every((point) => point.label && TEMPORAL_LABEL.test(point.label))
  const finalKind = kind === 'line' && !temporal ? 'bar' : kind
  return {
    ...figure,
    kind: finalKind,
    chartType: finalKind,
    categories: points.map((point, index) => point.label ?? String(index + 1)),
    series: [{ name, values: points.map((point) => point.numbers.at(-1)) }],
  }
}
