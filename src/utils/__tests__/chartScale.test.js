import { describe, expect, it } from 'vitest'
import { computeAxis, formatNumber } from '../chartScale.js'

describe('Diagramm-Skalierung', () => {
  it('enthaelt immer die Null (keine abgeschnittene Achse), auch bei Werten weit ueber Null', () => {
    const axis = computeAxis([98, 101, 103])
    expect(axis.min).toBe(0)
    expect(axis.max).toBeGreaterThanOrEqual(103)
    expect(axis.ticks[0]).toBe(0)
  })

  it('bildet negative Werte ab und behaelt die Null auf der Achse', () => {
    const axis = computeAxis([-30, 10])
    expect(axis.min).toBeLessThanOrEqual(-30)
    expect(axis.max).toBeGreaterThanOrEqual(10)
    expect(axis.ticks).toContain(0)
  })

  it('liefert runde, gleichmaessige Achsenmarken ohne Gleitkomma-Reste', () => {
    const { ticks, step } = computeAxis([0, 7, 12])
    expect(ticks.every((tick) => Number.isInteger(tick / step))).toBe(true)
    const kleine = computeAxis([0, 0.3])
    expect(kleine.ticks).toContain(0.1)
  })

  it('behandelt lauter Nullwerte ohne Division durch Null', () => {
    expect(computeAxis([0, 0, 0])).toMatchObject({ min: 0, max: 1 })
  })

  it('formatiert Zahlen deutsch', () => {
    expect(formatNumber(1234.5)).toBe('1.234,5')
  })

  it('MAJOR-01: kleine Werte bleiben unterscheidbar und werden nie zu 0 gerundet', () => {
    expect(formatNumber(1e-9)).toBe('1e-9')
    expect(formatNumber(2e-9)).toBe('2e-9')
    expect(formatNumber(1.5e-9)).toBe('1,5e-9')
    expect(formatNumber(0.001)).toBe('0,001')
    expect(formatNumber(0.0009)).toBe('9e-4')
    const ticks = computeAxis([1e-9, 2e-9]).ticks
    expect(ticks).toEqual([0, 5e-10, 1e-9, 1.5e-9, 2e-9])
    expect(ticks.map(formatNumber)).toEqual(['0', '5e-10', '1e-9', '1,5e-9', '2e-9'])
    expect(new Set(ticks.map(formatNumber)).size).toBe(ticks.length)
  })

  it('MAJOR-01: gemischte Dezimalgroessen ohne langen Dezimalschwanz und ohne Gleitkomma-Reste', () => {
    expect(formatNumber(0.5)).toBe('0,5')
    expect(formatNumber(0.1 + 0.2)).toBe('0,3')
    expect(formatNumber(12.25)).toBe('12,25')
    expect(formatNumber(1 / 3)).toBe('0,333333333')
    expect(formatNumber(123456.789)).toBe('123.456,789')
    expect(formatNumber(1e-3 + 1e-12)).toBe('0,001')
  })

  it('MAJOR-01: Werte, die frueher auf denselben Text gerundet wurden, bleiben verschieden', () => {
    const values = [1.001, 1.002, 1.0049, 0.0011, 0.0012, 1234.5671, 1234.5672, 1e-9, 1.1e-9]
    expect(new Set(values.map(formatNumber)).size).toBe(values.length)
    expect(formatNumber(1.001)).toBe('1,001')
  })

  it('MAJOR-01: grosse Zahlen bis zur Grenze 1e9 bleiben lesbar (Tausenderpunkte)', () => {
    expect(formatNumber(1e9)).toBe('1.000.000.000')
    expect(formatNumber(999999999)).toBe('999.999.999')
    expect(formatNumber(2.5e6)).toBe('2.500.000')
    const ticks = computeAxis([0, 1e9]).ticks
    expect(ticks.at(-1)).toBe(1e9)
    expect(ticks.map(formatNumber)).toContain('1.000.000.000')
  })

  it('MAJOR-01: negative Werte, Null und nie "-0"', () => {
    expect(formatNumber(-3)).toBe('-3')
    expect(formatNumber(-1234.5)).toBe('-1.234,5')
    expect(formatNumber(-1e-9)).toBe('-1e-9')
    expect(formatNumber(-1e9)).toBe('-1.000.000.000')
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(-0)).toBe('0')
    expect(Object.is(computeAxis([-5, 5]).ticks.find((tick) => tick === 0), -0)).toBe(false)
    for (const value of [-0, 0, -1e-9, 1e-9, -1, 5e8, -5e8]) expect(formatNumber(value)).not.toMatch(/^-0(,0+)?$/)
  })

  it('MAJOR-01: die Skalierung selbst bleibt mathematisch unveraendert', () => {
    expect(computeAxis([0, 7, 12]).ticks).toEqual([0, 5, 10, 15])
    expect(computeAxis([100, 120, 140]).ticks).toEqual([0, 50, 100, 150])
    expect(computeAxis([1e-9, 2e-9]).max).toBe(2e-9)
  })
})
