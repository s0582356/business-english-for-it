<script setup>
import { computed, ref, watch } from 'vue'
import AudioButton from './AudioButton.vue'
import { useItemAudio } from '../utils/useItemAudio.js'

// Fachneutrale Ordered-Steps-Komponente: nimmt beliebige Schritte + Ziel-
// reihenfolge entgegen. Kein Telephoning-spezifischer Code, damit die
// gleiche Komponente spaeter fuer Email Structure oder Socialising-Dialoge
// wiederverwendet werden kann.

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  isLastItem: {
    type: Boolean,
    required: true,
  },
})

const emit = defineEmits(['completed', 'next-item', 'finish'])

function shuffle(values) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[randomIndex]] = [result[randomIndex], result[index]]
  }
  return result
}

function sameOrder(a, b) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

// Eine Lernaufgabe darf nie bereits geloest starten: ein einzelner Fisher-
// Yates-Shuffle mischt die Anzeigereihenfolge. Trifft dieser eine Versuch
// zufaellig genau correctOrder, werden deterministisch die ersten beiden
// IDs getauscht - kein erneutes Shuffeln, keine unbeschraenkte Schleife,
// garantierte Terminierung.
function shuffledStartOrder(item) {
  const stepIds = item.steps.map((step) => step.id)
  if (stepIds.length <= 1) return stepIds
  const candidate = shuffle(stepIds)
  if (sameOrder(candidate, item.correctOrder)) {
    ;[candidate[0], candidate[1]] = [candidate[1], candidate[0]]
  }
  return candidate
}

const order = ref(shuffledStartOrder(props.item))
const checked = ref(false)
const { canPlayQuestion, canPlaySolution, playQuestion, playSolution } = useItemAudio(() => props.item, () => checked.value)

watch(
  () => props.item,
  (item) => {
    order.value = shuffledStartOrder(item)
    checked.value = false
  },
)

const stepById = computed(() => Object.fromEntries(props.item.steps.map((step) => [step.id, step])))

const isCorrect = computed(
  () =>
    order.value.length === props.item.correctOrder.length
    && order.value.every((id, index) => id === props.item.correctOrder[index]),
)

// Auf-/Ab-Antippen statt Drag-and-Drop: auf Touch-Geraeten zuverlaessiger
// bedienbar als Drag-Reordering.
function moveUp(index) {
  if (checked.value || index === 0) return
  const next = [...order.value]
  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
  order.value = next
}

function moveDown(index) {
  if (checked.value || index === order.value.length - 1) return
  const next = [...order.value]
  ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
  order.value = next
}

function stepClass(id, index) {
  if (!checked.value) return ''
  return props.item.correctOrder[index] === id ? 'process-step-correct' : 'process-step-wrong'
}

function check() {
  checked.value = true
  emit('completed', { id: props.item.id, correct: isCorrect.value })
}

const correctOrderSteps = computed(() => props.item.correctOrder.map((id) => stepById.value[id]))

const misplacedStepFeedback = computed(() => {
  if (!checked.value || !props.item.stepFeedback) return []
  return order.value
    .map((id, index) => ({ id, index }))
    .filter(({ id, index }) => props.item.correctOrder[index] !== id && props.item.stepFeedback[id])
    .map(({ id }) => ({ step: stepById.value[id], text: props.item.stepFeedback[id] }))
})

function nextItem() {
  if (props.isLastItem) {
    emit('finish')
  } else {
    emit('next-item')
  }
}
</script>

<template>
  <section class="question-card ordered-steps-trainer">
    <div class="question-meta">
      <span v-if="item.category">{{ item.category }}</span>
      <span>Reihenfolge</span>
    </div>

    <p class="training-instruction">Bringe die Aussagen mit ▲/▼ in die richtige Reihenfolge.</p>
    <div class="prompt-row">
      <h2>{{ item.prompt }}</h2>
      <AudioButton v-if="canPlayQuestion" label="Frage anhören" @play="playQuestion" />
    </div>

    <ol class="process-steps">
      <li v-for="(id, index) in order" :key="id" class="process-step" :class="stepClass(id, index)">
        <span class="process-step-index">{{ index + 1 }}</span>
        <span class="process-step-label">{{ stepById[id].label }}</span>
        <span class="process-step-controls">
          <button
            type="button"
            :disabled="checked || index === 0"
            aria-label="Nach oben verschieben"
            @click="moveUp(index)"
          >
            ▲
          </button>
          <button
            type="button"
            :disabled="checked || index === order.length - 1"
            aria-label="Nach unten verschieben"
            @click="moveDown(index)"
          >
            ▼
          </button>
        </span>
      </li>
    </ol>

    <button v-if="!checked" class="primary-button" type="button" @click="check">Reihenfolge prüfen</button>

    <div v-if="checked" class="feedback-box">
      <AudioButton v-if="canPlaySolution" label="Richtige Reihenfolge anhören" show-label @play="playSolution" />
      <p v-if="isCorrect" class="feedback-correct"><span aria-hidden="true">✓</span> Richtig.</p>
      <template v-else>
        <p class="feedback-wrong">
          <span aria-hidden="true">✗</span> Nicht ganz. Die richtige Reihenfolge ist unten markiert und vollständig aufgeführt.
        </p>

        <div class="correct-order-reveal">
          <p class="correct-order-label">So wäre die richtige Reihenfolge:</p>
          <ol class="correct-order-list">
            <li v-for="step in correctOrderSteps" :key="step.id">{{ step.label }}</li>
          </ol>
        </div>
      </template>

      <div v-for="entry in misplacedStepFeedback" :key="entry.step.id" class="explanation">
        <strong>{{ entry.step.label }}:</strong> {{ entry.text }}
      </div>

      <p v-if="item.explanation" class="explanation">{{ item.explanation }}</p>

      <button v-if="!isLastItem" class="primary-button" type="button" @click="nextItem">Weiter</button>
      <button v-else class="primary-button" type="button" @click="nextItem">Ergebnis anzeigen</button>
    </div>
  </section>
</template>
