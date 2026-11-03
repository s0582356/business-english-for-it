import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ChartFigure from '../ChartFigure.vue'
import { validateFigureLibrary } from '../../utils/figureLibrary.js'
import { figureData, withFigure } from '../../utils/__tests__/figureTestHelpers.js'

const figureOf = (data, index = 0) => validateFigureLibrary(data).figures[index]
const mountFigure = (figure, options = {}) => mount(ChartFigure, { props: { figure }, attachTo: document.body, ...options })

describe('ChartFigure: Rendering', () => {
  it('zeichnet ein Liniendiagramm mit je einer Linie, Markern, Legende und beschrifteten Achsen', () => {
    const wrapper = mountFigure(figureOf(figureData()))
    const svg = wrapper.get('svg.chart-svg')
    expect(svg.attributes('role')).toBe('img')
    expect(wrapper.findAll('polyline.chart-line')).toHaveLength(2)
    expect(wrapper.findAll('svg.chart-svg .chart-marker')).toHaveLength(6)
    const legend = wrapper.get('.chart-legend')
    expect(legend.text()).toContain('Alpha')
    expect(legend.text()).toContain('Beta')
    const axisText = wrapper.get('svg.chart-svg').text()
    for (const label of ['Step', 'Demo value (units)', 'S1', 'S2', 'S3']) expect(axisText).toContain(label)
    wrapper.unmount()
  })

  it('zeichnet ein Balkendiagramm mit einem Balken je Wert, ausgehend von der Nulllinie', () => {
    const wrapper = mountFigure(figureOf(figureData(), 1))
    const bars = wrapper.findAll('svg.chart-svg rect.chart-bar')
    expect(bars).toHaveLength(2)
    const heights = bars.map((bar) => Number(bar.attributes('height')))
    expect(heights[1]).toBeGreaterThan(heights[0]) // 6 > 4
    expect(heights[1] / heights[0]).toBeCloseTo(6 / 4, 5) // proportional zur Null, nicht abgeschnitten
    const zeroLine = wrapper.get('line.chart-zero')
    const baseline = Number(zeroLine.attributes('y1'))
    for (const bar of bars) expect(Number(bar.attributes('y')) + Number(bar.attributes('height'))).toBeCloseTo(baseline, 5)
    wrapper.unmount()
  })

  it('verzerrt Linien nicht: gleiche Werte liegen gleich hoch, hoehere Werte weiter oben, Nulllinie vorhanden', () => {
    const wrapper = mountFigure(figureOf(figureData()))
    const [alpha, beta] = wrapper.findAll('polyline.chart-line').map((line) => line.attributes('points').split(' ').map((pair) => Number(pair.split(',')[1])))
    expect(beta[0]).toBe(beta[1]) // 2 und 2
    expect(alpha[1]).toBeLessThan(alpha[0]) // 7 liegt ueber 3 (kleineres y)
    expect(beta[2]).toBeLessThan(alpha[1]) // 9 liegt ueber 7
    expect(wrapper.find('line.chart-zero').exists()).toBe(true)
    wrapper.unmount()
  })

  it('bietet eine Textalternative (title/desc am SVG) und eine Wertetabelle', () => {
    const wrapper = mountFigure(figureOf(figureData()))
    const svg = wrapper.get('svg.chart-svg')
    const [titleId, descId] = svg.attributes('aria-labelledby').split(' ')
    expect(svg.get(`#${titleId}`).text()).toBe('Demo line')
    expect(svg.get(`#${descId}`).text()).toContain('Demo-Text: Alpha 3, 7, 5')
    const rows = wrapper.findAll('table.chart-table tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[1].findAll('th, td').map((cell) => cell.text())).toEqual(['S2', '7', '2'])
    expect(wrapper.get('table.chart-table').text()).toContain('Alpha')
    wrapper.unmount()
  })

  it('verwendet pro Instanz eindeutige IDs, auch mit zwei Figuren gleichzeitig', () => {
    const a = mountFigure(figureOf(figureData()))
    const b = mountFigure(figureOf(figureData()))
    const ids = [a, b].map((wrapper) => wrapper.get('svg.chart-svg').attributes('aria-labelledby'))
    expect(ids[0]).not.toBe(ids[1])
    a.unmount(); b.unmount()
  })

  it('unterscheidet Reihen nicht nur durch Farbe (Marker-Form, Strichart)', () => {
    const wrapper = mountFigure(figureOf(figureData()))
    const lines = wrapper.findAll('polyline.chart-line')
    expect(lines[0].attributes('stroke-dasharray')).toBeUndefined()
    expect(lines[1].attributes('stroke-dasharray')).toBeTruthy()
    const groups = wrapper.findAll('svg.chart-svg > g[class^="chart-series"]')
    expect(groups[0].find('circle').exists()).toBe(true)
    expect(groups[1].find('rect').exists()).toBe(true)
    wrapper.unmount()
  })

  it('stellt Text aus den Daten nur als Text dar (kein HTML, kein innerHTML)', () => {
    const hostile = '<img src=x onerror="window.__pwned=1"><script>1</script>'
    const data = withFigure(figureData(), { title: hostile, xAxisLabel: hostile, textAlternative: hostile, categories: [hostile.slice(0, 50), 'S2', 'S3'], series: [{ name: hostile.slice(0, 50), values: [1, 2, 3] }] })
    const wrapper = mountFigure(figureOf(data))
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(document.body.querySelector('img')).toBeNull()
    expect(window.__pwned).toBeUndefined()
    expect(wrapper.get('.chart-title').text()).toBe(hostile)
    wrapper.unmount()
  })
})

describe('ChartFigure: Vergroesserung', () => {
  it('oeffnet einen Dialog mit grossem Diagramm, schliesst per Button und Escape und gibt den Fokus zurueck', async () => {
    const wrapper = mountFigure(figureOf(figureData()))
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await wrapper.get('.chart-enlarge').trigger('click')
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.findAll('svg.chart-svg')).toHaveLength(1)
    expect(document.activeElement.textContent).toBe('Schließen')

    await dialog.get('button').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement.textContent).toBe('Vergrößern')

    await wrapper.get('.chart-enlarge').trigger('click')
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('ChartFigure: Zahlen in Achse und Tabelle (MAJOR-01)', () => {
  it('Achsenmarken und Wertetabelle zeigen kleine Werte gleich und unterscheidbar', () => {
    const data = withFigure(figureData(), { chartType: 'bar', categories: ['A', 'B'], series: [{ name: 'S', values: [1e-9, 2e-9] }] })
    const wrapper = mountFigure(figureOf(data))
    const axisLabels = wrapper.findAll('svg.chart-svg .chart-grid text').map((node) => node.text())
    expect(axisLabels).toEqual(['0', '5e-10', '1e-9', '1,5e-9', '2e-9'])
    expect(new Set(axisLabels).size).toBe(axisLabels.length)
    const cells = wrapper.findAll('table.chart-table tbody td').map((cell) => cell.text())
    expect(cells).toEqual(['1e-9', '2e-9'])
    for (const cell of cells) expect(axisLabels).toContain(cell)
    wrapper.unmount()
  })
})

describe('ChartFigure: modaler Dialog (MINOR-01)', () => {
  const mountWithPage = (figure) => {
    document.body.innerHTML = '<div id="page"><button id="outside-before">davor</button><div id="host"></div><button id="outside-after">danach</button></div>'
    return mount(ChartFigure, { props: { figure }, attachTo: document.getElementById('host') })
  }
  const press = (key, options = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
    ;(document.activeElement ?? document.body).dispatchEvent(event)
    return event
  }

  it('macht beim Oeffnen alle Hintergrundelemente inert und stellt sie beim Schliessen wieder her', async () => {
    const wrapper = mountWithPage(figureOf(figureData()))
    document.getElementById('outside-after').setAttribute('inert', '') // schon vorher inert: darf danach nicht aufgehoben werden
    await wrapper.get('.chart-enlarge').trigger('click')
    expect(document.getElementById('outside-before').hasAttribute('inert')).toBe(true)
    expect(wrapper.get('.chart-plot').element.hasAttribute('inert')).toBe(true)
    expect(wrapper.get('[role="dialog"]').element.hasAttribute('inert')).toBe(false)
    expect(wrapper.get('.chart-enlarge').element.closest('[inert]')).not.toBeNull() // der ausloesende Button liegt in einem inerten Bereich
    await wrapper.get('[role="dialog"] button').trigger('click')
    expect(document.getElementById('outside-before').hasAttribute('inert')).toBe(false)
    expect(wrapper.get('.chart-plot').element.hasAttribute('inert')).toBe(false)
    expect(document.getElementById('outside-after').hasAttribute('inert')).toBe(true)
    wrapper.unmount()
  })

  it('haelt Tab und Shift+Tab im Dialog (nur ein Bedienelement: Schliessen)', async () => {
    const wrapper = mountWithPage(figureOf(figureData()))
    await wrapper.get('.chart-enlarge').trigger('click')
    const close = wrapper.get('[role="dialog"] button').element
    expect(document.activeElement).toBe(close)
    expect(press('Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
    wrapper.unmount()
  })

  it('holt den Fokus zurueck, wenn er nach aussen gelangt, und Tab fuehrt aus dem Nichts in den Dialog', async () => {
    const wrapper = mountWithPage(figureOf(figureData()))
    await wrapper.get('.chart-enlarge').trigger('click')
    const close = wrapper.get('[role="dialog"] button').element
    document.getElementById('outside-before').focus()
    expect(document.activeElement).toBe(close)
    wrapper.unmount()
  })

  it('Escape schliesst auch bei verlorenem Fokus und gibt den Fokus an den ausloesenden Button zurueck', async () => {
    const wrapper = mountWithPage(figureOf(figureData()))
    const trigger = wrapper.get('.chart-enlarge').element
    await wrapper.get('.chart-enlarge').trigger('click')
    document.activeElement.blur()
    expect(document.activeElement).toBe(document.body)
    press('Escape')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })

  it('entfernt alle Listener nach dem Schliessen: Escape/Tab ausserhalb haben keine Wirkung mehr', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const wrapper = mountWithPage(figureOf(figureData()))
    await wrapper.get('.chart-enlarge').trigger('click')
    const added = addSpy.mock.calls.filter(([type]) => type === 'keydown' || type === 'focusin')
    expect(added).toHaveLength(2)
    await wrapper.get('[role="dialog"] button').trigger('click')
    for (const [type, handler] of added) expect(removeSpy.mock.calls.some(([t, h]) => t === type && h === handler)).toBe(true)
    document.getElementById('outside-before').focus()
    expect(document.activeElement.id).toBe('outside-before') // kein Zurueckholen mehr
    expect(press('Tab').defaultPrevented).toBe(false)
    addSpy.mockRestore(); removeSpy.mockRestore()
    wrapper.unmount()
  })

  it('raeumt auch beim Entfernen der Komponente mit offenem Dialog auf (inert und Listener)', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const wrapper = mountWithPage(figureOf(figureData()))
    await wrapper.get('.chart-enlarge').trigger('click')
    expect(document.getElementById('outside-before').hasAttribute('inert')).toBe(true)
    wrapper.unmount()
    expect(document.getElementById('outside-before').hasAttribute('inert')).toBe(false)
    expect(removeSpy.mock.calls.filter(([type]) => type === 'keydown' || type === 'focusin')).toHaveLength(2)
    removeSpy.mockRestore()
  })

  it('stoert andere Komponenten nicht: ohne geoeffneten Dialog bleibt Escape/Tab unberuehrt', () => {
    const wrapper = mountWithPage(figureOf(figureData()))
    document.getElementById('outside-before').focus()
    expect(press('Escape').defaultPrevented).toBe(false)
    expect(press('Tab').defaultPrevented).toBe(false)
    wrapper.unmount()
  })
})
