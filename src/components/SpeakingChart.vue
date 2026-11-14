<script setup>
// Visualisiert die Diagrammdaten einer Graph-Description-Uebung. Linien-/Balkendiagramme nutzen die vorhandene
// ChartPlot-Komponente; Kreisdiagramme werden hier als einfaches SVG gezeichnet. Alle Texte laufen ueber
// Vue-Interpolation (kein innerHTML). Unter dem Diagramm stehen die Rohdaten als Text.
import { computed } from 'vue'
import ChartPlot from './ChartPlot.vue'
import { buildSpeakingChart } from '../utils/speakingChart.js'

const props = defineProps({
  chartData: { type: Object, required: true },
  uid: { type: String, required: true },
})

const chart = computed(() => buildSpeakingChart(props.chartData))

const RADIUS = 90
const slices = computed(() => {
  if (chart.value?.kind !== 'pie') return []
  const total = chart.value.slices.reduce((sum, slice) => sum + slice.value, 0)
  let angle = -Math.PI / 2
  return chart.value.slices.map((slice, index) => {
    const share = slice.value / total
    const start = angle
    angle += share * 2 * Math.PI
    const point = (theta) => `${(100 + RADIUS * Math.cos(theta)).toFixed(2)} ${(100 + RADIUS * Math.sin(theta)).toFixed(2)}`
    // Ein einziges 100-%-Stueck ist ein Vollkreis (ein Bogen vom Start zum Start waere leer).
    const path = share >= 0.9999 ? null : `M100 100 L${point(start)} A${RADIUS} ${RADIUS} 0 ${share > 0.5 ? 1 : 0} 1 ${point(angle)} Z`
    return { ...slice, index, percent: Math.round(share * 1000) / 10, path }
  })
})
</script>

<template>
  <figure class="speaking-chart">
    <figcaption class="speaking-chart-meta">
      <strong>{{ chartData.chartType }}</strong> · {{ chartData.metric }} · {{ chartData.timeframe }}
    </figcaption>

    <template v-if="chart && chart.kind !== 'pie'">
      <ChartPlot :figure="chart" :uid="uid" />
    </template>

    <template v-else-if="chart">
      <div class="speaking-pie">
        <svg class="speaking-pie-svg" viewBox="0 0 200 200" role="img" :aria-label="chart.textAlternative">
          <template v-for="slice in slices" :key="slice.index">
            <circle v-if="!slice.path" cx="100" cy="100" :r="RADIUS" :class="`chart-bar chart-series-${slice.index % 6}`" />
            <path v-else :d="slice.path" :class="`chart-bar chart-series-${slice.index % 6}`" stroke="var(--color-surface)" stroke-width="2" />
          </template>
        </svg>
        <ul class="chart-legend speaking-pie-legend" aria-label="Legende">
          <li v-for="slice in slices" :key="slice.index" :class="`chart-series-${slice.index % 6}`">
            <svg class="chart-swatch" viewBox="0 0 28 14" aria-hidden="true" focusable="false"><rect class="chart-bar" x="6" y="1" width="16" height="12" /></svg>
            <span>{{ slice.label }}: {{ slice.text }}</span>
          </li>
        </ul>
      </div>
    </template>

    <p v-else class="speaking-chart-fallback">Für diese Daten gibt es keine Zeichnung – hier die Zahlen als Text.</p>

    <p class="speaking-chart-data"><span class="practice-label">Daten:</span> {{ chartData.values }}</p>
  </figure>
</template>
