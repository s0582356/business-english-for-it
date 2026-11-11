// Auftrag 095: vollstaendiger, konservativer Wertvergleich (strictValue.js). Rein synthetische Daten.
import { describe, expect, it } from 'vitest'
import { UnsupportedValueError, strictClone, strictEqual } from '../strictValue.js'

const eq = (a, b) => strictEqual(a, b)

describe('strictEqual: Grundtypen und Struktur', () => {
  it('Primitive nach Typ und Wert; NaN gleich NaN, 0 ungleich -0, "1" ungleich 1', () => {
    expect(eq(1, 1)).toBe(true)
    expect(eq('a', 'a')).toBe(true)
    expect(eq(NaN, NaN)).toBe(true)
    expect(eq(0, -0)).toBe(false)
    expect(eq('1', 1)).toBe(false)
    expect(eq(null, undefined)).toBe(false)
    expect(eq(null, null)).toBe(true)
    expect(eq(10n, 10n)).toBe(true)
    expect(eq(10n, 10)).toBe(false)
    expect(eq(true, 1)).toBe(false)
  })

  it('alle eigenen Felder zaehlen: geaendert, hinzugefuegt, entfernt, undefined-Wert gegen fehlendes Feld', () => {
    const base = { key: 'k', areaTitle: 'Titel', extra: 1 }
    expect(eq(base, { ...base })).toBe(true)
    expect(eq(base, { ...base, areaTitle: 'Anderer Titel' })).toBe(false)
    expect(eq(base, { ...base, extra: 2 })).toBe(false)
    expect(eq(base, { ...base, neu: true })).toBe(false)
    const { extra, ...without } = base
    expect(extra).toBe(1)
    expect(eq(base, without)).toBe(false)
    expect(eq({ a: undefined }, {})).toBe(false)
    expect(eq({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true) // Reihenfolge der Felder ist egal
  })

  it('verschachtelte Objekte und Arrays vollstaendig; Typ (Array gegen Objekt) und Laenge zaehlen', () => {
    const deep = { a: { b: [1, { c: [2, 3] }] } }
    expect(eq(deep, strictClone(deep))).toBe(true)
    expect(eq(deep, { a: { b: [1, { c: [2, 4] }] } })).toBe(false)
    expect(eq(deep, { a: { b: [1, { c: [2, 3, 4] }] } })).toBe(false)
    expect(eq([1, 2], { 0: 1, 1: 2 })).toBe(false)
    expect(eq([1, , 3], [1, undefined, 3])).toBe(false) // Luecke gegen undefined
    expect(eq([1, , 3], [1, , 3])).toBe(true) // eslint-disable-line no-sparse-arrays
  })

  it('Date nach Zeitpunkt', () => {
    expect(eq(new Date(5), new Date(5))).toBe(true)
    expect(eq(new Date(5), new Date(6))).toBe(false)
    expect(eq(new Date(5), 5)).toBe(false)
  })
})

describe('strictEqual: Binaerdaten nach Typ UND Inhalt', () => {
  it('ArrayBuffer: gleiche Laenge anderer Inhalt, andere Laenge, identisch', () => {
    expect(eq(new Uint8Array([1, 2, 3, 4]).buffer, new Uint8Array([1, 2, 3, 4]).buffer)).toBe(true)
    expect(eq(new Uint8Array([1, 2, 3, 4]).buffer, new Uint8Array([9, 8, 7, 6]).buffer)).toBe(false)
    expect(eq(new Uint8Array([1, 2, 3, 4]).buffer, new Uint8Array([1, 2, 3]).buffer)).toBe(false)
  })

  it('Uint8Array [1,2,3,4] gegen [9,8,7,6] und gegen identischen Inhalt', () => {
    expect(eq(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2, 3, 4]))).toBe(true)
    expect(eq(new Uint8Array([1, 2, 3, 4]), new Uint8Array([9, 8, 7, 6]))).toBe(false)
  })

  it('ArrayBuffer gegen Uint8Array mit denselben Bytes: ungleich (Typ zaehlt)', () => {
    const bytes = [1, 2, 3, 4]
    expect(eq(new Uint8Array(bytes).buffer, new Uint8Array(bytes))).toBe(false)
    expect(eq(new Uint8Array(bytes), new Uint8Array(bytes).buffer)).toBe(false)
  })

  it('verschiedene TypedArray-Typen mit denselben Bytes sind ungleich; DataView unterscheidet sich von Uint8Array', () => {
    const buffer = new Uint8Array([1, 0, 2, 0]).buffer
    expect(eq(new Uint8Array(buffer), new Int8Array(buffer))).toBe(false)
    expect(eq(new Uint16Array(buffer), new Uint8Array(buffer))).toBe(false)
    expect(eq(new DataView(buffer), new Uint8Array(buffer))).toBe(false)
    expect(eq(new DataView(buffer), new DataView(new Uint8Array([1, 0, 2, 0]).buffer))).toBe(true)
    expect(eq(new DataView(buffer), new DataView(new Uint8Array([1, 0, 2, 9]).buffer))).toBe(false)
    expect(eq(new Float32Array([1.5, NaN]), new Float32Array([1.5, NaN]))).toBe(true)
    expect(eq(new Float32Array([1.5, 2]), new Float32Array([1.5, 3]))).toBe(false)
  })

  it('Ansichten gelten nur als gleich, wenn Typ, Offset, Laenge UND der gesamte Puffer gleich sind (097)', () => {
    const base = new Uint8Array([0, 1, 2, 3, 4, 5]).buffer
    expect(eq(new Uint8Array(base, 1, 3), new Uint8Array(new Uint8Array([0, 1, 2, 3, 4, 5]).buffer, 1, 3))).toBe(true)
    // gleiche sichtbaren Bytes [1,2,3], aber anderer Puffer / anderer Offset -> ungleich
    expect(eq(new Uint8Array(base, 1, 3), new Uint8Array([1, 2, 3]))).toBe(false)
    expect(eq(new Uint8Array(base, 2, 3), new Uint8Array([2, 3, 4]))).toBe(false)
  })

  it('Binaerdaten innerhalb von Objekten werden mitverglichen', () => {
    const record = { bytes: new Uint8Array([1, 2, 3, 4]).buffer, fileName: 'a.json' }
    expect(eq(record, { ...record, bytes: new Uint8Array([1, 2, 3, 4]).buffer })).toBe(true)
    expect(eq(record, { ...record, bytes: new Uint8Array([1, 2, 3, 5]).buffer })).toBe(false)
  })
})

describe('Nicht unterstuetzte Werte: nie still als gleich', () => {
  const unsupported = [
    ['Map', () => new Map([[1, 2]])],
    ['Set', () => new Set([1])],
    ['RegExp', () => /a/],
    ['Error', () => new Error('x')],
    ['Funktion', () => () => 1],
    ['Symbol', () => Symbol('s')],
    ['Klasseninstanz', () => new (class Fremd { constructor() { this.a = 1 } })()],
    ['Blob', () => new Blob(['x'])],
  ]

  it.each(unsupported)('%s: Vergleich und Kopie werfen UnsupportedValueError', (_name, make) => {
    expect(() => strictEqual({ x: make() }, { x: make() })).toThrow(UnsupportedValueError)
    expect(() => strictClone({ x: make() })).toThrow(UnsupportedValueError)
  })

  it('Typunterschied zu einem nicht unterstuetzten Wert wirft ebenfalls statt "ungleich" zu raten', () => {
    expect(() => strictEqual({ x: new Map() }, { x: 1 })).not.toThrow() // Typ unterschiedlich: sicher ungleich
    expect(strictEqual({ x: new Map() }, { x: 1 })).toBe(false)
    expect(() => strictEqual({ x: new Map() }, { x: new Set() })).toThrow(UnsupportedValueError)
  })

  it('Zyklen und uebergrosse Strukturen werden abgewiesen', () => {
    const cyclic = { a: 1 }
    cyclic.self = cyclic
    expect(() => strictClone(cyclic)).toThrow(UnsupportedValueError)
    expect(() => strictEqual(cyclic, cyclic)).toThrow(UnsupportedValueError)
    let deep = {}
    const root = deep
    for (let index = 0; index < 60; index += 1) deep = deep.next = {}
    expect(() => strictClone(root)).toThrow(UnsupportedValueError)
    expect(() => strictClone(Array.from({ length: 30000 }, (_, index) => ({ index })))).toThrow(UnsupportedValueError)
  })
})

describe('strictClone: tiefe, unabhaengige Kopie', () => {
  it('Kopie ist gleich, teilt aber keinen Speicher mit dem Original', () => {
    const original = { bytes: new Uint8Array([1, 2, 3, 4]).buffer, view: new Uint8Array([5, 6]), nested: { list: [1, { x: 2 }] }, when: new Date(7) }
    const copy = strictClone(original)
    expect(eq(original, copy)).toBe(true)
    expect(copy.bytes).not.toBe(original.bytes)
    expect(copy.view).not.toBe(original.view)
    expect(copy.nested.list[1]).not.toBe(original.nested.list[1])
    new Uint8Array(original.bytes)[0] = 99
    original.nested.list[1].x = 3
    expect([...new Uint8Array(copy.bytes)]).toEqual([1, 2, 3, 4])
    expect(copy.nested.list[1].x).toBe(2)
    expect(eq(original, copy)).toBe(false)
  })

  it('Ansichten werden mit ihrem GESAMTEN Puffer, Offset und Laenge kopiert (Typ bleibt erhalten)', () => {
    const base = new Uint8Array([0, 1, 2, 3, 4, 5]).buffer
    const copy = strictClone(new Uint8Array(base, 2, 3))
    expect(Object.prototype.toString.call(copy)).toBe('[object Uint8Array]')
    expect([...copy]).toEqual([2, 3, 4])
    expect(copy.byteOffset).toBe(2)
    expect(copy.length).toBe(3)
    expect(copy.buffer.byteLength).toBe(6)
    expect([...new Uint8Array(copy.buffer)]).toEqual([0, 1, 2, 3, 4, 5])
    expect(copy.buffer).not.toBe(base)
    const typed = strictClone(new Int16Array([1, -2, 3]))
    expect(Object.prototype.toString.call(typed)).toBe('[object Int16Array]')
    expect([...typed]).toEqual([1, -2, 3])
  })
})

describe('Laufzeit bei der zulaessigen Maximalgroesse (5 MB)', () => {
  it('Kopie und Vergleich von 5 MB bleiben unter einer Sekunde (jsdom/Node); kein weiterer Hash noetig', () => {
    const size = 5 * 1024 * 1024
    const bytes = new Uint8Array(size)
    for (let index = 0; index < size; index += 1024) bytes[index] = index % 251
    const record = { bytes: bytes.buffer, fileName: 'gross.json', areaTitle: 'T' }
    const startClone = performance.now()
    const copy = strictClone(record)
    const cloneMs = performance.now() - startClone
    const startEqual = performance.now()
    const same = strictEqual(record, copy)
    const equalMs = performance.now() - startEqual
    expect(same).toBe(true)
    expect(cloneMs).toBeLessThan(1000)
    expect(equalMs).toBeLessThan(1000)
    // letztes Byte unterscheidet sich -> auch dann wird es erkannt
    new Uint8Array(copy.bytes)[size - 1] ^= 1
    expect(strictEqual(record, copy)).toBe(false)
  })
})
