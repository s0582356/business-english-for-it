import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChartFigure from '../ChartFigure.vue'
import ChartPlot from '../ChartPlot.vue'
import { validateFigureLibrary } from '../../utils/figureLibrary.js'
import { formatNumber } from '../../utils/chartScale.js'
import { figureData, withFigure } from '../../utils/__tests__/figureTestHelpers.js'

// Obergrenzen der Eingabe (FIGURE_LIMITS): 24 Kategorien a 60 Zeichen, 6 Reihen, Werte bis 1e9.
const longName = (index) => `${String.fromCharCode(65 + (index % 26))}${'x'.repeat(58)}${index % 10}`
function extremeFigure(chartType, values = (series, index) => Math.round(((series + 1) / 6) * 1e9 * (((index % 5) + 1) / 5)) * (index % 2 ? -1 : 1)) {
  const categories = Array.from({ length: 24 }, (_, index) => longName(index))
  const series = Array.from({ length: 6 }, (_, seriesIndex) => ({ name: `Reihe-${seriesIndex}-${'n'.repeat(50)}`, values: categories.map((_, index) => values(seriesIndex, index)) }))
  return validateFigureLibrary(withFigure(figureData(), { chartType, categories, series, xAxisLabel: 'X'.repeat(80), yAxisLabel: 'Y'.repeat(60), unit: 'U'.repeat(20) })).figures[0]
}
const mountPlot = (figure) => mount(ChartPlot, { props: { figure, uid: 'u' } })
const viewBoxOf = (wrapper) => wrapper.get('svg.chart-svg').attributes('viewBox').split(' ').map(Number)

describe('Diagramm mit Eingabegrenzen (MINOR-02)', () => {
  it('Eingabe an den Grenzen ist gueltig (Voraussetzung der folgenden Pruefungen)', () => {
    expect(extremeFigure('line').categories).toHaveLength(24)
    expect(extremeFigure('bar').series).toHaveLength(6)
  })

  it('kuerzt lange Kategorien und Achsentitel, haelt aber den vollen Text im <title> des Textes', () => {
    const figure = extremeFigure('line')
    const wrapper = mountPlot(figure)
    const labels = wrapper.findAll('svg.chart-svg text.chart-tick title').filter((node) => figure.categories.includes(node.text()))
    expect(labels.length).toBeGreaterThan(0)
    for (const title of labels) {
      const shown = title.element.parentElement.textContent.replace(title.text(), '')
      expect(shown.length).toBeLessThanOrEqual(10)
      expect(shown.endsWith('…')).toBe(true)
    }
    const axisTitles = wrapper.findAll('text.chart-axis-title')
    for (const node of axisTitles) expect(node.element.textContent.length - node.get('title').text().length).toBeLessThanOrEqual(40)
    expect(axisTitles[0].get('title').text()).toBe('X'.repeat(80))
    expect(axisTitles[1].get('title').text()).toBe(`${'Y'.repeat(60)} (${'U'.repeat(20)})`)
    wrapper.unmount()
  })

  it('duennt Kategoriebeschriftungen bei 24 Kategorien aus, damit sich gedrehte Texte nicht ueberlagern', () => {
    const wrapper = mountPlot(extremeFigure('line'))
    const shown = wrapper.findAll('svg.chart-svg text.chart-tick').filter((node) => node.attributes('transform'))
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.length).toBeLessThan(24)
    const xs = shown.map((node) => Number(node.attributes('x')))
    for (let index = 1; index < xs.length; index++) expect(xs[index] - xs[index - 1]).toBeGreaterThanOrEqual(34)
    wrapper.unmount()
  })

  it('schneidet grosse Y-Achsenwerte nicht ab: der linke Rand ist breit genug fuer die laengste Marke', () => {
    const wrapper = mountPlot(extremeFigure('bar'))
    const axisX = Number(wrapper.get('line.chart-axis').attributes('x1'))
    const labels = wrapper.findAll('svg.chart-svg .chart-grid text')
    const longest = Math.max(...labels.map((node) => node.text().length))
    expect(longest).toBeGreaterThanOrEqual(13) // "-1.000.000.000" bzw. "1.000.000.000"
    expect(axisX).toBeGreaterThanOrEqual(longest * 11)
    for (const label of labels) expect(Number(label.attributes('x'))).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('alle gezeichneten Elemente liegen innerhalb der Zeichenflaeche (Linien-Variante, 6 Reihen, 24 Kategorien)', () => {
    const wrapper = mountPlot(extremeFigure('line'))
    const [, , width, height] = viewBoxOf(wrapper)
    const points = wrapper.findAll('polyline.chart-line').flatMap((line) => line.attributes('points').split(' ').map((pair) => pair.split(',').map(Number)))
    expect(points).toHaveLength(6 * 24)
    for (const [x, y] of points) {
      expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(width)
      expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(height)
    }
    wrapper.unmount()
  })

  it('Balken bleiben mathematisch korrekt: Hoehe proportional zum Wert, gemeinsame Nulllinie, sichtbare Breite', () => {
    const figure = extremeFigure('bar')
    const wrapper = mountPlot(figure)
    const bars = wrapper.findAll('svg.chart-svg rect.chart-bar')
    expect(bars).toHaveLength(6 * 24)
    const zero = Number(wrapper.get('line.chart-zero').attributes('y1'))
    const flat = figure.series.flatMap((series) => series.values)
    const perUnit = Number(bars[0].attributes('height')) / Math.abs(flat[0])
    bars.forEach((bar, index) => {
      const heightValue = Number(bar.attributes('height'))
      expect(Number(bar.attributes('width'))).toBeGreaterThan(0.5)
      expect(heightValue / Math.abs(flat[index])).toBeCloseTo(perUnit, 9)
      const y = Number(bar.attributes('y'))
      expect(flat[index] >= 0 ? y + heightValue : y).toBeCloseTo(zero, 5) // positive Balken enden, negative beginnen an der Nulllinie
    })
    wrapper.unmount()
  })

  it('kurze, wenige Kategorien bleiben unveraendert waagerecht und vollstaendig', () => {
    const wrapper = mountPlot(validateFigureLibrary(figureData()).figures[0])
    const labels = wrapper.findAll('svg.chart-svg text.chart-tick').filter((node) => ['S1', 'S2', 'S3'].includes(node.element.textContent.replace(/\s/g, '').slice(-2)))
    expect(labels).toHaveLength(3)
    expect(labels.every((node) => !node.attributes('transform'))).toBe(true)
    wrapper.unmount()
  })

  it('mittellange Kategorien (z. B. "Week 1" bis "Week 5") bleiben waagerecht und ungekuerzt, 24 lange werden gedreht', () => {
    const weeks = validateFigureLibrary(withFigure(figureData(), { categories: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'], series: [{ name: 'A', values: [1, 2, 3, 4, 5] }] })).figures[0]
    const flat = mountPlot(weeks)
    const flatLabels = flat.findAll('svg.chart-svg text.chart-tick').map((node) => node.element.lastChild.textContent).filter((text) => text.startsWith('Week')) // sichtbarer Text (title-Kind abgezogen)
    expect(flatLabels).toEqual(['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'])
    expect(flat.findAll('svg.chart-svg text.chart-tick').some((node) => node.attributes('transform'))).toBe(false)
    expect(viewBoxOf(flat)[3]).toBe(360)
    flat.unmount()
    const rotated = mountPlot(extremeFigure('line'))
    expect(rotated.findAll('svg.chart-svg text.chart-tick').some((node) => node.attributes('transform'))).toBe(true)
    expect(viewBoxOf(rotated)[3]).toBeGreaterThan(360)
    rotated.unmount()
  })

  it('die Wertetabelle liegt in einem eigenen, fokussierbaren Scrollbereich und enthaelt alle vollstaendigen Namen und Zahlen', () => {
    const figure = extremeFigure('line')
    const wrapper = mount(ChartFigure, { props: { figure } })
    const scroll = wrapper.get('.chart-table-scroll')
    expect(scroll.attributes('tabindex')).toBe('0')
    expect(scroll.attributes('role')).toBe('region')
    expect(scroll.findAll('tbody tr')).toHaveLength(24)
    expect(scroll.findAll('thead th')).toHaveLength(7)
    expect(scroll.text()).toContain(figure.categories[23]) // voller 60-Zeichen-Name
    expect(scroll.text()).toContain(formatNumber(figure.series[5].values[3]))
    expect(wrapper.get('.chart-legend').text()).toContain(figure.series[5].name) // Legende zeigt den vollen Reihennamen
    wrapper.unmount()
  })

  it('CSS: Tabellenbereich, Titel und Legende koennen die Seite nicht verbreitern', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const css = readFileSync(resolve(__dirname, '../../style.css'), 'utf8')
    expect(css).toMatch(/\.chart-table-scroll\s*\{[^}]*overflow:\s*auto/)
    expect(css).toMatch(/\.chart-table-scroll\s*\{[^}]*max-width:\s*100%/)
    expect(css).toMatch(/\.chart-figure\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.chart-title\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(css).toMatch(/\.chart-legend li span\s*\{[^}]*overflow-wrap:\s*anywhere/)
  })
})
