// Konservativer, SYNCHRONER Vergleich und tiefe Kopie fuer gespeicherte Werte (Auftrag 095, gehaertet in 097).
//
// Wozu: Eine Loeschbestaetigung darf nur den Datensatz entfernen, den der Nutzer bestaetigt hat. Dafuer wird der
// vollstaendige gespeicherte Wert beim Vorbereiten kopiert (strictClone) und in der Loesch-Transaktion mit dem dann
// gespeicherten Wert verglichen (strictEqual). Kein JSON (das Typen und Strukturen verschleiert), kein Hash (asynchron,
// wuerde die IndexedDB-Transaktion beenden), keine Auswahl "bekannter" Felder: ALLE eigenen Daten zaehlen.
//
// Konservativ heisst: Was nicht sicher verglichen werden kann, wirft UnsupportedValueError. Es gilt nie als gleich,
// weil es uebersprungen wurde.
//
// Vollstaendigkeit (097):
//   - Objekte UND Arrays: alle eigenen aufzaehlbaren String-Schluessel (bei Arrays auch Zusatzeigenschaften wie
//     `array.extra`), Array-Laenge, Luecken (sparse) gegen `undefined`, fehlendes Feld gegen Feld mit Wert `undefined`.
//   - Views (TypedArray, DataView): Typ, byteOffset, byteLength/length UND der GESAMTE zugrunde liegende ArrayBuffer
//     (auch der ausserhalb des sichtbaren Ausschnitts). Die Kopie behaelt Offset und Laenge bei.
//   - Verweisstruktur: Wird derselbe Puffer/dasselbe Objekt mehrfach referenziert, muss das auf beiden Seiten gleich
//     sein (Strukturgleichheit des Wertegraphen, wie ihn IndexedDB ablegt).
//
// Unterstuetzt: undefined, null, boolean, number (Object.is: NaN gleich NaN, 0 ungleich -0), bigint, string, Date,
// ArrayBuffer, alle TypedArrays und DataView, normale Objekte und Arrays (verschachtelt, nur Datenfelder).
// Nicht unterstuetzt (Fehler): Funktionen, Symbole, Map, Set, RegExp, Error, Blob/File, SharedArrayBuffer, in der Groesse
// veraenderbare ArrayBuffer, Klasseninstanzen, Accessor-Eigenschaften (get/set), Zyklen sowie zu tiefe/zu grosse
// Strukturen (Knoten, Gesamtbytes).
//
// Aufwand: linear in der Datenmenge; fuer die zulaessigen 5 MB reichen Millisekunden und eine zusaetzliche Kopie.

export class UnsupportedValueError extends Error {
  constructor(reason) {
    super(`Wert nicht sicher vergleichbar: ${reason}`)
    this.name = 'UnsupportedValueError'
  }
}

const MAX_DEPTH = 32
const MAX_NODES = 20000
// Obergrenze fuer ALLE bei einem Vergleich/einer Kopie bewegten Bytes (viele Views auf verschiedene grosse Puffer).
const MAX_TOTAL_BYTES = 64 * 1024 * 1024

const tagOf = (value) => Object.prototype.toString.call(value)
const isArrayBuffer = (value) => tagOf(value) === '[object ArrayBuffer]'

// Normale Objekte/Arrays (beliebiger Realm): Prototyp ist Object.prototype bzw. Array.prototype, keine Klasse.
function isPlainObject(value) {
  if (tagOf(value) !== '[object Object]') return false
  const proto = Object.getPrototypeOf(value)
  return proto === null || Object.getPrototypeOf(proto) === null
}

function isPlainArray(value) {
  if (!Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return Array.isArray(proto) && Object.getPrototypeOf(Object.getPrototypeOf(proto)) === null
}

// Konstruktoren der unterstuetzten TypedArrays (aus dem Tag, nicht aus value.constructor, das ueberschrieben sein kann).
const TYPED_ARRAYS = {
  '[object Int8Array]': Int8Array,
  '[object Uint8Array]': Uint8Array,
  '[object Uint8ClampedArray]': Uint8ClampedArray,
  '[object Int16Array]': Int16Array,
  '[object Uint16Array]': Uint16Array,
  '[object Int32Array]': Int32Array,
  '[object Uint32Array]': Uint32Array,
  '[object Float32Array]': Float32Array,
  '[object Float64Array]': Float64Array,
  ...(typeof BigInt64Array === 'function' ? { '[object BigInt64Array]': BigInt64Array, '[object BigUint64Array]': BigUint64Array } : {}),
}

function viewKind(view) {
  const tag = tagOf(view)
  if (tag === '[object DataView]') return { tag, Type: DataView }
  const Type = TYPED_ARRAYS[tag]
  if (!Type) throw new UnsupportedValueError(`Ansicht ${tag}`)
  return { tag, Type }
}

function assertPlainBuffer(buffer) {
  if (!isArrayBuffer(buffer)) throw new UnsupportedValueError(tagOf(buffer)) // z. B. SharedArrayBuffer
  if (buffer.resizable === true) throw new UnsupportedValueError('in der Groesse veraenderbarer ArrayBuffer')
}

function spend(budget, nodes, bytes = 0) {
  budget.nodes += nodes
  budget.bytes += bytes
  if (budget.nodes > MAX_NODES) throw new UnsupportedValueError('Struktur zu gross')
  if (budget.bytes > MAX_TOTAL_BYTES) throw new UnsupportedValueError('zu viele Bytes')
}

// Eigene aufzaehlbare String-Schluessel (bei Arrays inkl. Indizes vorhandener Elemente und Zusatzeigenschaften). Nur
// Datenfelder: ein Accessor koennte bei jedem Lesen etwas anderes liefern und ist nicht sicher vergleichbar.
function dataKeys(value) {
  const keys = Object.keys(value)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || 'get' in descriptor || 'set' in descriptor) throw new UnsupportedValueError('Accessor-Eigenschaft')
  }
  return keys
}

const isPrimitive = (type, value) => value === undefined || value === null || type === 'boolean' || type === 'number' || type === 'bigint' || type === 'string'

// ---------------------------------------------------------------------------------------------------------------------
// Kopie
// ---------------------------------------------------------------------------------------------------------------------

function cloneBuffer(buffer, ctx) {
  assertPlainBuffer(buffer)
  if (ctx.memo.has(buffer)) return ctx.memo.get(buffer)
  spend(ctx.budget, 1, buffer.byteLength)
  const copy = buffer.slice(0)
  ctx.memo.set(buffer, copy)
  return copy
}

function cloneValue(value, depth, ctx) {
  const type = typeof value
  if (isPrimitive(type, value)) return value
  if (type === 'function' || type === 'symbol') throw new UnsupportedValueError(type)
  if (depth > MAX_DEPTH) throw new UnsupportedValueError('Struktur zu tief')
  if (ctx.path.has(value)) throw new UnsupportedValueError('Zyklus')
  if (ctx.memo.has(value)) return ctx.memo.get(value) // mehrfach referenziert: Verweisstruktur bleibt erhalten
  const tag = tagOf(value)
  if (tag === '[object Date]') {
    spend(ctx.budget, 1)
    const copy = new Date(value.getTime())
    ctx.memo.set(value, copy)
    return copy
  }
  if (isArrayBuffer(value)) return cloneBuffer(value, ctx)
  if (ArrayBuffer.isView(value)) {
    // Ganzen zugrunde liegenden Puffer kopieren und die Ansicht (Typ, Offset, Laenge) darauf neu aufbauen.
    const { Type } = viewKind(value)
    spend(ctx.budget, 1)
    const buffer = cloneBuffer(value.buffer, ctx)
    const copy = Type === DataView ? new DataView(buffer, value.byteOffset, value.byteLength) : new Type(buffer, value.byteOffset, value.length)
    ctx.memo.set(value, copy)
    return copy
  }
  const isArray = isPlainArray(value)
  if (!isArray && !isPlainObject(value)) throw new UnsupportedValueError(tag)
  spend(ctx.budget, 1)
  const copy = isArray ? new Array(value.length) : {}
  ctx.memo.set(value, copy)
  ctx.path.add(value)
  try {
    for (const key of dataKeys(value)) copy[key] = cloneValue(value[key], depth + 1, ctx)
  } finally {
    ctx.path.delete(value)
  }
  return copy
}

export function strictClone(value) {
  return cloneValue(value, 0, { budget: { nodes: 0, bytes: 0 }, memo: new Map(), path: new Set() })
}

// ---------------------------------------------------------------------------------------------------------------------
// Vergleich
// ---------------------------------------------------------------------------------------------------------------------

function sameBytes(a, b) {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}

// Verweisstruktur: jedes Objekt/jeder Puffer der Seite A entspricht genau einem der Seite B (und umgekehrt).
// Liefert true = schon verglichen und passend, false = Widerspruch, undefined = erstmals gesehen.
function checkAlias(a, b, ctx) {
  if (ctx.seenAB.has(a)) return ctx.seenAB.get(a) === b
  if (ctx.seenBA.has(b)) return false
  ctx.seenAB.set(a, b)
  ctx.seenBA.set(b, a)
  return undefined
}

function equalBuffers(a, b, ctx) {
  assertPlainBuffer(a)
  assertPlainBuffer(b)
  const alias = checkAlias(a, b, ctx)
  if (alias !== undefined) return alias
  if (a.byteLength !== b.byteLength) return false
  spend(ctx.budget, 1, a.byteLength)
  return sameBytes(new Uint8Array(a), new Uint8Array(b))
}

function equalValues(a, b, depth, ctx) {
  const typeA = typeof a
  const typeB = typeof b
  if (typeA !== typeB) {
    // Auch nicht unterstuetzte Typen duerfen nicht still als "gleich" durchgehen.
    if (typeA === 'function' || typeA === 'symbol' || typeB === 'function' || typeB === 'symbol') throw new UnsupportedValueError('function/symbol')
    return false
  }
  if (isPrimitive(typeA, a)) return Object.is(a, b)
  if (typeA === 'function' || typeA === 'symbol') throw new UnsupportedValueError(typeA)
  if (depth > MAX_DEPTH) throw new UnsupportedValueError('Struktur zu tief')
  if (ctx.path.has(a)) throw new UnsupportedValueError('Zyklus')
  const tag = tagOf(a)
  if (tag !== tagOf(b)) {
    // Verschiedene (aber moeglicherweise unterstuetzte) Typen: ArrayBuffer vs. Uint8Array usw. => ungleich.
    assertSupported(a)
    assertSupported(b)
    return false
  }
  if (tag === '[object Date]') {
    const alias = checkAlias(a, b, ctx)
    return alias !== undefined ? alias : Object.is(a.getTime(), b.getTime())
  }
  if (isArrayBuffer(a)) return equalBuffers(a, b, ctx)
  if (ArrayBuffer.isView(a)) {
    if (!ArrayBuffer.isView(b)) return false
    const kindA = viewKind(a)
    const kindB = viewKind(b)
    if (kindA.tag !== kindB.tag) return false
    const alias = checkAlias(a, b, ctx)
    if (alias !== undefined) return alias
    // Typ, Offset und Laenge UND der gesamte zugrunde liegende Puffer (auch ausserhalb des sichtbaren Ausschnitts).
    if (a.byteOffset !== b.byteOffset || a.byteLength !== b.byteLength) return false
    if (kindA.Type !== DataView && a.length !== b.length) return false
    spend(ctx.budget, 1)
    return equalBuffers(a.buffer, b.buffer, ctx)
  }
  const isArray = isPlainArray(a)
  if (isArray !== isPlainArray(b)) return false
  if (!isArray && !(isPlainObject(a) && isPlainObject(b))) throw new UnsupportedValueError(tag)
  if (isArray && a.length !== b.length) return false
  const alias = checkAlias(a, b, ctx)
  if (alias !== undefined) return alias
  spend(ctx.budget, 1)
  const keysA = dataKeys(a)
  const keysB = dataKeys(b)
  if (keysA.length !== keysB.length) return false
  ctx.path.add(a)
  try {
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false
      if (!equalValues(a[key], b[key], depth + 1, ctx)) return false
    }
  } finally {
    ctx.path.delete(a)
  }
  return true
}

export function strictEqual(a, b) {
  return equalValues(a, b, 0, { budget: { nodes: 0, bytes: 0 }, seenAB: new Map(), seenBA: new Map(), path: new Set() })
}

// Wirft, wenn der Wert (oberste Ebene) nicht zu den unterstuetzten Typen gehoert.
function assertSupported(value) {
  const type = typeof value
  if (isPrimitive(type, value)) return
  if (type === 'function' || type === 'symbol') throw new UnsupportedValueError(type)
  const tag = tagOf(value)
  if (tag === '[object Date]' || isArrayBuffer(value) || isPlainArray(value) || isPlainObject(value)) return
  if (ArrayBuffer.isView(value)) {
    viewKind(value)
    return
  }
  throw new UnsupportedValueError(tag)
}
