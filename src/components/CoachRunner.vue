<script setup>
import { computed, inject, ref, watch } from 'vue'
import ChoiceCard from './ChoiceCard.vue'
import GapInputTrainer from './GapInputTrainer.vue'
import CoachExampleRow from './CoachExampleRow.vue'
import CoachProduceStep from './CoachProduceStep.vue'
import { AUDIO_CONTROLLER_KEY } from '../utils/audioController.js'
import { isExerciseStep } from '../utils/coachLibrary.js'
import { completeCoachUnit, getCoachUnitState, getUnitStepOverview, saveCoachPosition, saveCoachStepResult } from '../utils/coachStorage.js'

const props = defineProps({
  unit: { type: Object, required: true },
  mode: { type: String, default: 'learn' }, // 'learn' | 'review'
})
const emit = defineEmits(['back'])

const audio = inject(AUDIO_CONTROLLER_KEY, null)

// Lernen: alle Schritte, Start an der gespeicherten Position (Resume).
// Wiederholen: nur die Uebungsschritte, bevorzugt die schwierigen (sonst alle Uebungen).
function buildStepList() {
  if (props.mode !== 'review') return props.unit.steps
  const exercises = props.unit.steps.filter(isExerciseStep)
  const { difficult, stale } = getUnitStepOverview(props.unit)
  const focus = exercises.filter((step) => difficult.includes(step.stepId) || stale.includes(step.stepId))
  return focus.length > 0 ? focus : exercises
}

function resumeIndex(steps) {
  if (props.mode === 'review') return 0
  const saved = getCoachUnitState(props.unit.unitId).currentStepId
  const index = steps.findIndex((step) => step.stepId === saved)
  return index > 0 ? index : 0 // unbekannte/entfernte Position -> Anfang, nichts wird geloescht
}

const steps = buildStepList()
const index = ref(resumeIndex(steps))
const selectedAnswer = ref(null)
const isAnswered = ref(false)
const finished = ref(false)
const summary = ref(null)
const exercisesDone = ref(0)
const exercisesGood = ref(0)
const troubleIds = new Set()
const exampleAudioAvailable = ref(null)

const step = computed(() => steps[index.value])
const isLast = computed(() => index.value === steps.length - 1)
const stepLabel = computed(() => `Schritt ${index.value + 1} von ${steps.length}`)
const progressPercent = computed(() => Math.round((index.value / steps.length) * 100))

watch(step, (current) => {
  if (current && props.mode !== 'review') saveCoachPosition(props.unit.unitId, current.stepId)
}, { immediate: true })

// Hinweis, falls fuer die Beispielsaetze kein Audio vorliegt (kein ZIP geladen oder keine passenden Dateien).
watch([step, () => audio?.packRevision.value], async ([current]) => {
  exampleAudioAvailable.value = null
  if (current?.type !== 'examples' || !audio) return
  const resolved = await Promise.all(current.examples.map((example) => audio.resolveFiles(example)))
  if (step.value === current) exampleAudioAvailable.value = resolved.some((files) => files.q)
}, { immediate: true })

function record(status) {
  saveCoachStepResult(props.unit.unitId, step.value, status)
  if (status === 'seen') return
  exercisesDone.value++
  if (status === 'correct' || status === 'self-ok') exercisesGood.value++
  else troubleIds.add(step.value.stepId)
}

function onChoiceSelect(option) {
  if (isAnswered.value) return
  selectedAnswer.value = option
  isAnswered.value = true
  record(option === step.value.correctAnswer ? 'correct' : 'incorrect')
}

function onGapCompleted({ correct }) {
  record(correct ? 'correct' : 'incorrect')
}

function onProduceCompleted({ status }) {
  record(status)
}

function finish() {
  const hadTrouble = troubleIds.size > 0
  completeCoachUnit(props.unit.unitId, { hadTrouble, mode: props.mode })
  summary.value = { hadTrouble, dueAt: getCoachUnitState(props.unit.unitId).review?.dueAt ?? null }
  finished.value = true
}

function advance() {
  if (isLast.value) {
    finish()
    return
  }
  index.value++
  selectedAnswer.value = null
  isAnswered.value = false
}

function advanceReading() {
  record('seen')
  advance()
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('de-DE') : ''
}
</script>

<template>
  <section class="coach-run">
    <button type="button" class="back-button" @click="emit('back')">← Zur Lerncoach-Übersicht</button>

    <section v-if="finished" class="result-card coach-summary" aria-label="Zusammenfassung">
      <p class="eyebrow">{{ mode === 'review' ? 'Wiederholung abgeschlossen' : 'Einheit abgeschlossen' }}</p>
      <h2>{{ unit.unitTitle }}</h2>
      <p v-if="exercisesDone > 0" class="result-message">{{ exercisesGood }} von {{ exercisesDone }} Übungen sicher gelöst.</p>
      <p v-if="summary.hadTrouble" class="explanation">Einige Punkte waren noch nicht sicher. Sie kommen bei der nächsten Wiederholung wieder dran.</p>
      <p v-else class="perfect-message">Alles sicher gelöst – trotzdem lohnt sich eine kurze Wiederholung.</p>
      <p v-if="summary.dueAt" class="coach-next-review">Nächste Wiederholung empfohlen ab: <strong>{{ formatDate(summary.dueAt) }}</strong></p>
      <div class="result-actions">
        <button class="primary-button" type="button" @click="emit('back')">Zur Lerncoach-Übersicht</button>
      </div>
    </section>

    <template v-else-if="step">
      <div class="coach-progress" role="group" aria-label="Fortschritt in dieser Einheit">
        <p class="eyebrow">{{ unit.unitTitle }}<span v-if="mode === 'review'"> · Wiederholung</span></p>
        <p class="coach-step-label">{{ stepLabel }}</p>
        <div class="coach-progress-bar" aria-hidden="true"><div class="coach-progress-fill" :style="{ width: `${progressPercent}%` }" /></div>
      </div>
      <p v-if="audio?.autoplayBlocked.value" class="audio-hint" role="status">
        Automatisches Vorlesen wurde vom Browser blockiert – tippe auf 🔊, um den Satz zu hören.
      </p>

      <section v-if="step.type === 'explain'" :key="step.stepId" class="question-card coach-explain">
        <h2>{{ step.title }}</h2>
        <p v-for="paragraph in step.paragraphs" :key="paragraph" class="coach-paragraph" lang="de">{{ paragraph }}</p>
        <p v-if="step.pattern" class="coach-pattern" lang="en">{{ step.pattern }}</p>
        <p v-if="step.caution" class="coach-caution" role="note" lang="de">⚠ {{ step.caution }}</p>
        <button class="primary-button" type="button" @click="advanceReading">Weiter</button>
      </section>

      <section v-else-if="step.type === 'examples'" :key="step.stepId" class="question-card coach-examples">
        <h2>{{ step.title }}</h2>
        <p v-if="step.intro" class="coach-paragraph" lang="de">{{ step.intro }}</p>
        <p v-if="exampleAudioAvailable === false" class="audio-hint" role="status">
          Für diese Sätze ist kein Audio geladen. Wähle zusammen mit den Lernbibliotheken das Lerncoach-Audio-Paket (.zip), um sie zu hören.
        </p>
        <ul class="coach-example-list">
          <CoachExampleRow v-for="example in step.examples" :key="example.id" :example="example" />
        </ul>
        <button class="primary-button" type="button" @click="advanceReading">Weiter</button>
      </section>

      <ChoiceCard
        v-else-if="step.type === 'choice'"
        :key="step.stepId"
        :item="step"
        :selected-answer="selectedAnswer"
        :is-answered="isAnswered"
        :is-last-item="isLast"
        @select-answer="onChoiceSelect"
        @next-item="advance"
        @finish="advance"
      />

      <GapInputTrainer
        v-else-if="step.type === 'gap'"
        :key="step.stepId"
        :item="step"
        :is-last-item="isLast"
        @completed="onGapCompleted"
        @next-item="advance"
        @finish="advance"
      />

      <CoachProduceStep
        v-else-if="step.type === 'produce'"
        :key="step.stepId"
        :step="step"
        :is-last-item="isLast"
        @completed="onProduceCompleted"
        @next-item="advance"
      />

      <section v-else-if="step.type === 'recap'" :key="step.stepId" class="question-card coach-recap">
        <h2>{{ step.title }}</h2>
        <ul class="coach-recap-points" lang="de">
          <li v-for="point in step.points" :key="point">{{ point }}</li>
        </ul>
        <p class="explanation coach-recommendation" lang="de">{{ step.recommendation }}</p>
        <button class="primary-button" type="button" @click="advanceReading">Einheit abschließen</button>
      </section>
    </template>
  </section>
</template>
