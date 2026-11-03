<script setup>
// Abbildung zu einer Aufgabe: Diagramm, Textalternative mit Wertetabelle und Vergroesserung (wichtig am Handy).
//
// Die Vergroesserung ist ein modaler Dialog: Solange er offen ist, sind alle uebrigen Elemente der Seite inert
// (nicht fokussierbar, nicht klickbar), Tab/Shift+Tab bleiben im Dialog, Escape schliesst ihn auch dann, wenn der
// Fokus verloren gegangen ist, und beim Schliessen (auch beim Entfernen der Komponente) wird alles zurueckgesetzt.
import { nextTick, onBeforeUnmount, ref } from 'vue'
import ChartPlot from './ChartPlot.vue'
import ChartSpeaking from './ChartSpeaking.vue'
import { formatNumber } from '../utils/chartScale.js'

defineProps({
  figure: { type: Object, required: true },
  // Sprechtraining: Beispielsaetze erst nach abgegebener Antwort der Aufgabe (sonst koennten sie die Loesung verraten).
  speakingUnlocked: { type: Boolean, default: false },
})

let counter = 0
const uid = `figure-${++counter}-${Math.random().toString(36).slice(2, 8)}`

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

const speakingOpen = ref(false) // Sprechtraining aufgeklappt: Abbildung wird kompakter, nicht mehr haftend
const enlarged = ref(false)
const enlargeButton = ref(null)
const closeButton = ref(null)
const overlay = ref(null)
let inertElements = []

// Alle Geschwister entlang des Pfades vom Dialog bis <body> werden inert; nur was wir selbst gesetzt haben, wird zurueckgenommen.
function makeBackgroundInert() {
  let node = overlay.value
  while (node && node !== document.body && node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && !sibling.hasAttribute('inert')) {
        sibling.setAttribute('inert', '')
        inertElements.push(sibling)
      }
    }
    node = node.parentElement
  }
}

function restoreBackground() {
  for (const element of inertElements) element.removeAttribute('inert')
  inertElements = []
}

function onDocumentKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeOverlay()
    return
  }
  if (event.key !== 'Tab' || !overlay.value) return
  const focusable = [...overlay.value.querySelectorAll(FOCUSABLE)]
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (!overlay.value.contains(active)) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

// Gelangt der Fokus trotzdem nach aussen (z. B. per Skript oder aelterem Browser ohne inert), zurueckholen.
function onDocumentFocusin(event) {
  if (overlay.value && !overlay.value.contains(event.target)) closeButton.value?.focus()
}

function deactivate() {
  document.removeEventListener('keydown', onDocumentKeydown, true)
  document.removeEventListener('focusin', onDocumentFocusin)
  restoreBackground()
}

async function openOverlay() {
  enlarged.value = true
  await nextTick()
  makeBackgroundInert()
  document.addEventListener('keydown', onDocumentKeydown, true)
  document.addEventListener('focusin', onDocumentFocusin)
  closeButton.value?.focus()
}

async function closeOverlay() {
  if (!enlarged.value) return
  deactivate()
  enlarged.value = false
  await nextTick()
  enlargeButton.value?.focus()
}

onBeforeUnmount(deactivate)
</script>

<template>
  <figure class="chart-figure" :class="{ 'chart-figure--speaking': speakingOpen }" :data-figure-id="figure.figureId">
    <figcaption class="chart-figure-head">
      <span class="chart-title">{{ figure.title }}</span>
      <button ref="enlargeButton" type="button" class="chart-enlarge" aria-haspopup="dialog" @click="openOverlay">Vergrößern</button>
    </figcaption>
    <ChartPlot :figure="figure" :uid="`${uid}-inline`" />
    <ChartSpeaking v-if="figure.speaking" :speaking="figure.speaking" :unlocked="speakingUnlocked" :uid="`${uid}-speaking`" @toggle="speakingOpen = $event" />
    <details class="chart-text">
      <summary>Textalternative und Wertetabelle</summary>
      <p>{{ figure.textAlternative }}</p>
      <div class="chart-table-scroll" role="region" tabindex="0" aria-label="Wertetabelle (scrollbar)">
      <table class="chart-table">
        <caption>{{ figure.yAxisLabel }} ({{ figure.unit }})</caption>
        <thead>
          <tr>
            <th scope="col">{{ figure.xAxisLabel }}</th>
            <th v-for="series in figure.series" :key="series.name" scope="col">{{ series.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(category, index) in figure.categories" :key="index">
            <th scope="row">{{ category }}</th>
            <td v-for="series in figure.series" :key="series.name">{{ formatNumber(series.values[index]) }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </details>

    <div v-if="enlarged" ref="overlay" class="chart-overlay" role="dialog" aria-modal="true" :aria-label="`${figure.title} (vergrößert)`" @click.self="closeOverlay">
      <div class="chart-overlay-panel">
        <div class="chart-figure-head">
          <p class="chart-title">{{ figure.title }}</p>
          <button ref="closeButton" type="button" class="chart-enlarge" @click="closeOverlay">Schließen</button>
        </div>
        <ChartPlot :figure="figure" :uid="`${uid}-large`" />
      </div>
    </div>
  </figure>
</template>
