// Skalierung fuer Diagramme. Die Werteachse enthaelt immer die Null (keine abgeschnittene Achse),
// damit Unterschiede nicht uebertrieben dargestellt werden.

function niceStep(rawStep) {
  const exponent = Math.floor(Math.log10(rawStep))
  const fraction = rawStep / 10 ** exponent
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * 10 ** exponent
}

// Liefert { min, max, step, ticks } mit "runden" Achsenmarken, min <= 0 <= max.
export function computeAxis(values, targetTicks = 5) {
  const finite = values.filter((value) => Number.isFinite(value))
  const low = Math.min(0, ...finite)
  const high = Math.max(0, ...finite)
  if (high === low) return { min: 0, max: 1, step: 1, ticks: [0, 1] }
  const step = niceStep((high - low) / targetTicks)
  // Toleranz gegen Gleitkomma-Rest (z. B. 2e-9 / 5e-10 = 4.000000000000001), sonst entstuende eine unnoetige Marke.
  const min = Math.floor(low / step + 1e-9) * step
  const max = Math.ceil(high / step - 1e-9) * step
  const ticks = []
  const count = Math.round((max - min) / step)
  for (let index = 0; index <= count; index++) ticks.push(Number((min + index * step).toPrecision(12)))
  return { min: Number(min.toPrecision(12)), max: Number(max.toPrecision(12)), step, ticks }
}

// Zahl fuer Achsenmarken UND Wertetabelle (gleiche Zahl -> gleicher Text, deutsches Format).
// - Hoechstens 9 signifikante Stellen: Werte, die sich im Diagramm unterscheiden lassen, bleiben auch im Text verschieden;
//   Gleitkomma-Reste (0,30000000000000004) werden nicht angezeigt.
// - Feste Schreibweise mit Tausenderpunkten im Bereich 0,001 bis unter 10^10 (deckt die erlaubten Werte bis 1e9 samt
//   Achsenrundung ab, "1.000.000.000" bleibt lesbar); kleinere Betraege (ausser 0) wissenschaftlich ("1,5e-9"),
//   damit kleine Werte nie zu 0 gerundet werden und kein langer Dezimalschwanz entsteht.
// - Nie "-0".
export const SIGNIFICANT_DIGITS = 9
const FIXED_MIN = 1e-3
const FIXED_MAX = 1e10

export function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'
  const rounded = Number(value.toPrecision(SIGNIFICANT_DIGITS))
  const magnitude = Math.abs(rounded)
  if (magnitude >= FIXED_MIN && magnitude < FIXED_MAX) {
    return new Intl.NumberFormat('de-DE', { maximumSignificantDigits: SIGNIFICANT_DIGITS, useGrouping: true }).format(rounded)
  }
  const [mantissa, exponent] = rounded.toExponential(SIGNIFICANT_DIGITS - 1).split('e')
  const trimmed = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa
  return `${trimmed.replace('.', ',')}e${Number(exponent)}`
}
