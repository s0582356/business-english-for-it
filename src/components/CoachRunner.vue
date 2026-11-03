<script setup>
import { computed, inject, reactive, ref, watch } from 'vue'
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
  const { difficult, stale, open } = getUnitStepOverview(props.unit)
  // Auch neu hinzugekommene (noch nie geloeste) Uebungen kommen in die Wiederholung, damit sie in einer bereits
  // durchgearbeiteten Einheit nicht untergehen.
  const focus = exercises.filter((step) => difficult.includes(step.stepId) || stale.includes(step.stepId) || open.includes(step.stepId))
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
// Getrennte Zaehler je Quelle - nichts wird zu einer Gesamtzahl "sicher gelöst" vermischt.
const stats = reactive({ autoDone: 0, autoOk: 0, structureDone: 0, structureMet: 0, unclear: 0, selfOk: 0, selfAlmost: 0, selfAgain: 0, improved: 0, gaveUp: 0 })
const troubleIds = new Set()
// Wortgleiche Saetze aus der Lektion zaehlen beim Freitext als Abschreiben.
const referenceSentences = props.unit.steps.flatMap((unitStep) => {
  if (unitStep.type === 'examples') return unitStep.examples.map((example) => example.en)
  if (unitStep.type === 'produce') return unitStep.modelAnswers
  if (unitStep.type === 'choice') return [unitStep.correctAnswer]
  return []
})
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

function record(status, details = {}) {
  saveCoachStepResult(props.unit.unitId, step.value, status, new Date(), details)
  if (status === 'seen') return
  const produce = details.produce
  let trouble = status === 'incorrect' || status === 'self-almost' || status === 'self-again' || status === 'gave-up'
  if (step.value.type === 'choice' || step.value.type === 'gap') {
    stats.autoDone++
    if (status === 'correct') stats.autoOk++
  } else if (produce?.checked) {
    if (!produce.gaveUp) {
      stats.structureDone++
      if (produce.final === 'met' && !produce.copied) stats.structureMet++
      if (produce.final === 'unclear') stats.unclear++ // bearbeitet, aber nicht bestaetigt: kein objektiver Erfolg
    }
    if (produce.final === 'issues') trouble = true
    if (produce.improved) stats.improved++
    if (produce.gaveUp) stats.gaveUp++
  } else if (status === 'gave-up') {
    stats.gaveUp++
  }
  if (status === 'self-ok') stats.selfOk++
  else if (status === 'self-almost') stats.selfAlmost++
  else if (status === 'self-again') stats.selfAgain++
  if (trouble) troubleIds.add(step.value.stepId)
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

function onProduceCompleted({ status, produce }) {
  record(status, { produce })
}

// Gibt es in dieser Einheit (aktueller Inhaltsstand) noch einen Freitext, der nur "nicht zuverlaessig pruefbar" war?
// Das gilt auch dann, wenn andere Aufgaben desselben Durchgangs objektiv erfolgreich waren (gemischter Durchgang).
function hasOpenUncertainty() {
  const state = getCoachUnitState(props.unit.unitId)
  return props.unit.steps.some((unitStep) => {
    const saved = state.steps[unitStep.stepId]
    return Boolean(saved) && saved.revision === unitStep.revision && saved.produce?.final === 'unclear' && !saved.produce.gaveUp
  })
}

function finish() {
  const hadTrouble = troubleIds.size > 0
  // Die Wiederholungsstufe steigt nur mit mindestens einem objektiven ERFOLG (automatisch richtig oder Struktur erfuellt).
  // Bearbeitet heisst nicht erfolgreich: Selbsteinschaetzung zaehlt nicht. Bleibt irgendwo eine Unsicherheit (unclear)
  // offen, bleibt der Wiederholungsplan unveraendert - die richtigen Choice-/Gap-Ergebnisse bleiben trotzdem gespeichert.
  const objective = stats.autoOk + stats.structureMet > 0
  const uncertain = hasOpenUncertainty()
  completeCoachUnit(props.unit.unitId, { hadTrouble, mode: props.mode, objective, uncertain })
  summary.value = { hadTrouble, uncertain, dueAt: getCoachUnitState(props.unit.unitId).review?.dueAt ?? null }
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
      <p class="eyebrow">{{ mode === 'review' ? 'Wiederholung abgeschlossen' : 'Einheit durchgearbeitet' }}</p>
      <h2>{{ unit.unitTitle }}</h2>
      <ul class="coach-summary-list" aria-label="Ergebnisse nach Quelle" lang="de">
        <li v-if="stats.autoDone > 0"><strong>Automatisch geprüft</strong> (Auswahl, Lücken): {{ stats.autoOk }} von {{ stats.autoDone }} richtig.</li>
        <li v-if="stats.structureDone > 0"><strong>Strukturcheck</strong> (eigene Sätze): bei {{ stats.structureMet }} von {{ stats.structureDone }} Sätzen wurde die Struktur erfüllt. Das ist keine Grammatikbewertung.</li>
        <li v-if="stats.selfOk + stats.selfAlmost + stats.selfAgain > 0"><strong>Deine Selbsteinschätzung</strong>: {{ stats.selfOk }}× passt, {{ stats.selfAlmost }}× fast, {{ stats.selfAgain }}× nochmal üben.</li>
        <li v-if="stats.unclear > 0"><strong>Nicht zuverlässig prüfbar</strong>: {{ stats.unclear }} {{ stats.unclear === 1 ? 'Satz' : 'Sätze' }}. Das ist kein Erfolgsnachweis; {{ stats.unclear === 1 ? 'er bleibt' : 'sie bleiben' }} zur erneuten Übung vorgemerkt.</li>
        <li v-if="stats.improved > 0"><strong>Struktur im 2. Versuch verbessert</strong> (laut Strukturcheck, keine Grammatikbewertung): {{ stats.improved }}.</li>
        <li v-if="stats.gaveUp > 0"><strong>Lösung direkt angezeigt</strong> (zählt nicht als gelöst): {{ stats.gaveUp }}.</li>
      </ul>
      <p v-if="summary.hadTrouble" class="explanation">Einige Punkte waren noch nicht sicher. Sie kommen bei der nächsten Wiederholung wieder dran.</p>
      <p v-else-if="summary.uncertain" class="explanation" lang="de">Noch offen: Mindestens ein eigener Satz konnte nicht zuverlässig geprüft werden. Er bleibt zur erneuten Übung vorgemerkt. Die Wiederholungsstufe steigt dadurch nicht und ein bestehender Termin wird nicht weiter hinausgeschoben. Deine richtigen Auswahl- und Lückenaufgaben bleiben gespeichert.</p>
      <p v-else class="perfect-message">In diesem Durchgang wurde kein Problem erkannt – eine kurze Wiederholung festigt trotzdem.</p>
      <p class="explanation" lang="de">Durchgearbeitet heißt nicht beherrscht. Dass Auswahl- und Lückenaufgaben sicher sitzen, zeigt sich erst, wenn du sie an mindestens zwei verschiedenen Tagen richtig gelöst hast. Der Strukturcheck und deine Selbsteinschätzung zählen dafür nicht.</p>
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
        :references="referenceSentences"
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
