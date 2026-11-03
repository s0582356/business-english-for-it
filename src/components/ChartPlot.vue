<script setup>
// Zeichnet ein Linien- oder Balkendiagramm als SVG. Alle Texte laufen ueber Vue-Interpolation (automatisch
// escaped); es wird kein innerHTML verwendet. Die Werteachse enthaelt immer die Null.
//
// Lesbarkeit bei langen Daten: Der Rand links richtet sich nach der laengsten Achsenmarke, lange Kategorien- und
// Achsentexte werden im Diagramm gekuerzt (mit Ellipse; der volle Text steht im <title> des Textes, in der
// Wertetabelle und in der Textalternative), bei vielen Kategorien wird gedreht und ausgeduennt. Die Zeichnung
// selbst (Positionen, Hoehen) haengt davon nicht ab.
import { computed } from 'vue'
import { computeAxis, formatNumber } from '../utils/chartScale.js'

const props = defineProps({
  figure: { type: Object, required: true },
  uid: { type: String, required: true },
})

const WIDTH = 640
const PLOT_HEIGHT = 254
const TOP = 40
const RIGHT = 20
const CHAR_WIDTH = 12 // grobe Zeichenbreite in SVG-Einheiten (auch bei der groessten Schrift auf dem Handy)
const MIN_LABEL_SPACING = 34 // gedrehte Kategorienamen brauchen mindestens so viel Abstand (Schrifthoehe / sin 45 Grad)
const TITLE_MAX_CHARS = 40
const ROTATED_MAX_CHARS = 10

function shorten(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}

const axis = computed(() => computeAxis(props.figure.series.flatMap((series) => series.values)))
const categoryCount = computed(() => props.figure.categories.length)
const isBar = computed(() => props.figure.chartType === 'bar')

const tickLabels = computed(() => axis.value.ticks.map((value) => ({ value, label: formatNumber(value) })))
const left = computed(() => Math.max(70, 20 + Math.max(...tickLabels.value.map((tick) => tick.label.length)) * CHAR_WIDTH))
const plotWidth = computed(() => WIDTH - left.value - RIGHT)
const bottom = computed(() => (rotateLabels.value ? 66 + Math.round(ROTATED_MAX_CHARS * 14 * 0.72) : 66))
const height = computed(() => TOP + PLOT_HEIGHT + bottom.value)
const axisBottom = TOP + PLOT_HEIGHT
const band = computed(() => plotWidth.value / categoryCount.value)
// Waagerecht nur, wenn auch der laengste Name in sein Band passt; sonst gedreht, gekuerzt und ausgeduennt.
const rotateLabels = computed(() => Math.max(...props.figure.categories.map((label) => label.length)) * CHAR_WIDTH > band.value * 0.9)

function yOf(value) {
  return TOP + PLOT_HEIGHT * (1 - (value - axis.value.min) / (axis.value.max - axis.value.min))
}
function centerX(index) {
  return left.value + band.value * (index + 0.5)
}

const ticks = computed(() => tickLabels.value.map((tick) => ({ ...tick, y: yOf(tick.value) })))
const labelEvery = computed(() => (rotateLabels.value ? Math.max(1, Math.ceil(MIN_LABEL_SPACING / band.value)) : 1))
const xLabels = computed(() => props.figure.categories
  .map((full, index) => ({ full, shown: rotateLabels.value ? shorten(full, ROTATED_MAX_CHARS) : full, x: centerX(index), index }))
  .filter((label) => label.index % labelEvery.value === 0))
const zeroY = computed(() => yOf(0))
const xTitle = computed(() => shorten(props.figure.xAxisLabel, TITLE_MAX_CHARS))
const yTitleFull = computed(() => `${props.figure.yAxisLabel} (${props.figure.unit})`)
const yTitle = computed(() => shorten(yTitleFull.value, TITLE_MAX_CHARS))

const lines = computed(() => props.figure.series.map((series, seriesIndex) => {
  const points = series.values.map((value, index) => ({ x: centerX(index), y: yOf(value), value }))
  return { name: series.name, seriesIndex, points, path: points.map((point) => `${point.x},${point.y}`).join(' ') }
}))

const bars = computed(() => {
  const group = band.value * 0.76
  const seriesCount = props.figure.series.length
  const slot = group / seriesCount
  return props.figure.series.flatMap((series, seriesIndex) => series.values.map((value, index) => {
    const top = Math.min(yOf(value), zeroY.value)
    const width = Math.max(slot * 0.88, 0.8)
    return {
      key: `${seriesIndex}-${index}`,
      seriesIndex,
      x: left.value + index * band.value + (band.value - group) / 2 + seriesIndex * slot + (slot - width) / 2,
      y: top,
      width,
      height: Math.abs(yOf(value) - zeroY.value),
    }
  }))
})

const ids = computed(() => ({ title: `${props.uid}-title`, desc: `${props.uid}-desc` }))
</script>

<template>
  <div class="chart-plot">
    <svg
      class="chart-svg"
      :viewBox="`0 0 ${WIDTH} ${height}`"
      role="img"
      :aria-labelledby="`${ids.title} ${ids.desc}`"
      preserveAspectRatio="xMidYMid meet"
    >
      <title :id="ids.title">{{ figure.title }}</title>
      <desc :id="ids.desc">{{ figure.textAlternative }}</desc>

      <g class="chart-grid">
        <g v-for="tick in ticks" :key="tick.value">
          <line :x1="left" :x2="WIDTH - RIGHT" :y1="tick.y" :y2="tick.y" :class="tick.value === 0 ? 'chart-zero' : 'chart-gridline'" />
          <text :x="left - 8" :y="tick.y" class="chart-tick" text-anchor="end" dominant-baseline="middle">{{ tick.label }}</text>
        </g>
      </g>
      <line class="chart-axis" :x1="left" :x2="left" :y1="TOP" :y2="axisBottom" />

      <g v-for="label in xLabels" :key="label.index">
        <text
          class="chart-tick"
          :x="label.x"
          :y="axisBottom + 18"
          :text-anchor="rotateLabels ? 'end' : 'middle'"
          :dominant-baseline="rotateLabels ? 'middle' : undefined"
          :transform="rotateLabels ? `rotate(-45 ${label.x} ${axisBottom + 18})` : undefined"
        ><title>{{ label.full }}</title>{{ label.shown }}</text>
      </g>

      <text class="chart-axis-title" :x="left + plotWidth / 2" :y="height - 8" text-anchor="middle"><title>{{ figure.xAxisLabel }}</title>{{ xTitle }}</text>
      <text class="chart-axis-title" x="8" y="20" text-anchor="start"><title>{{ yTitleFull }}</title>{{ yTitle }}</text>

      <template v-if="isBar">
        <rect
          v-for="bar in bars"
          :key="bar.key"
          :class="`chart-bar chart-series-${bar.seriesIndex}`"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
        />
      </template>
      <template v-else>
        <g v-for="line in lines" :key="line.name" :class="`chart-series-${line.seriesIndex}`">
          <polyline class="chart-line" :points="line.path" :stroke-dasharray="line.seriesIndex % 3 === 1 ? '7 4' : line.seriesIndex % 3 === 2 ? '2 4' : undefined" />
          <template v-for="(point, pointIndex) in line.points" :key="pointIndex">
            <circle v-if="line.seriesIndex % 3 === 0" class="chart-marker" :cx="point.x" :cy="point.y" r="5" />
            <rect v-else-if="line.seriesIndex % 3 === 1" class="chart-marker" :x="point.x - 5" :y="point.y - 5" width="10" height="10" />
            <polygon v-else class="chart-marker" :points="`${point.x},${point.y - 6} ${point.x + 6},${point.y + 5} ${point.x - 6},${point.y + 5}`" />
          </template>
        </g>
      </template>
    </svg>

    <ul class="chart-legend" aria-label="Legende">
      <li v-for="(series, seriesIndex) in figure.series" :key="series.name" :class="`chart-series-${seriesIndex}`">
        <svg class="chart-swatch" viewBox="0 0 28 14" aria-hidden="true" focusable="false">
          <rect v-if="isBar" class="chart-bar" x="6" y="1" width="16" height="12" />
          <template v-else>
            <line class="chart-line" x1="1" x2="27" y1="7" y2="7" :stroke-dasharray="seriesIndex % 3 === 1 ? '7 4' : seriesIndex % 3 === 2 ? '2 4' : undefined" />
            <circle v-if="seriesIndex % 3 === 0" class="chart-marker" cx="14" cy="7" r="4.5" />
            <rect v-else-if="seriesIndex % 3 === 1" class="chart-marker" x="9.5" y="2.5" width="9" height="9" />
            <polygon v-else class="chart-marker" points="14,1.5 19.5,11.5 8.5,11.5" />
          </template>
        </svg>
        <span>{{ series.name }}</span>
      </li>
    </ul>
  </div>
</template>
