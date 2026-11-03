<script setup>
import { computed, ref, watch } from 'vue'
import AudioButton from './AudioButton.vue'
import { useItemAudio } from '../utils/useItemAudio.js'
import { checkSentence, compareAttempts, didImprove, NOT_CHECKED } from '../utils/coachSentenceCheck.js'

const props = defineProps({
  step: { type: Object, required: true },
  isLastItem: { type: Boolean, default: false },
  // Saetze aus der Lektion (Beispiele, Musterloesungen): ein wortgleicher Satz zaehlt als Abschreiben.
  references: { type: Array, default: () => [] },
})
const emit = defineEmits(['completed', 'next-item'])

// Der eigene Satz lebt nur in dieser Ansicht (Arbeitsspeicher): nicht gespeichert, nicht gesendet, nicht im completed-Ereignis.
const answer = ref('')
const selfAssessment = ref(null)

// Gefuehrtes Schreibtraining (Schritt hat einen "check"): write -> feedback -> (write -> feedback) -> revealed.
// Ohne "check" bleibt der bisherige Ablauf: Vergleich mit der Musterloesung und Selbsteinschaetzung.
const guided = computed(() => Boolean(props.step.check))
const stage = ref('write') // 'write' | 'feedback' | 'revealed'
const attempt = ref(1)
const first = ref(null) // { text, result }
const second = ref(null)
const gaveUp = ref(false)
const legacyRevealed = ref(false)

const revealed = computed(() => (guided.value ? stage.value === 'revealed' : legacyRevealed.value))
const { canPlaySolution, playSolution } = useItemAudio(() => props.step, () => revealed.value)

watch(() => props.step, () => {
  answer.value = ''
  selfAssessment.value = null
  stage.value = 'write'
  attempt.value = 1
  first.value = null
  second.value = null
  gaveUp.value = false
  legacyRevealed.value = false
})

const choices = [
  { status: 'self-ok', label: 'Passt zur Checkliste' },
  { status: 'self-almost', label: 'Fast – kleine Fehler' },
  { status: 'self-again', label: 'Nochmal üben' },
]

const OUTCOME_TITLE = { met: 'Struktur erfüllt', unclear: 'Nicht zuverlässig prüfbar', issues: 'Strukturfehler erkannt' }
const OUTCOME_NOTE = {
  met: 'Das heißt nicht, dass dein Satz grammatisch korrekt ist. Der Check prüft nur die Merkmale in der Liste.',
  unclear: 'Zur Struktur kann ich nichts Sicheres sagen. Prüfe deinen Satz selbst anhand der Checkliste.',
  issues: 'Das sind sichere Hinweise zur Struktur. Alles andere prüft der Check nicht.',
}
const STATE_ICON = { ok: '✓', problem: '✗', unsure: '?', na: '–' }
const STATE_WORD = { ok: 'erfüllt', problem: 'Problem', unsure: 'nicht sicher prüfbar', na: 'nicht relevant' }

const squash = (text) => text.trim().replace(/\s+/g, ' ')
const current = computed(() => (attempt.value === 1 ? first.value : second.value))
const canCheck = computed(() => {
  if (squash(answer.value) === '') return false
  return attempt.value === 1 || squash(answer.value) !== squash(first.value?.text ?? '')
})

function check() {
  if (!canCheck.value) return
  const text = squash(answer.value)
  const result = checkSentence(props.step.check, text, { references: props.references })
  if (attempt.value === 1) first.value = { text, result }
  else second.value = { text, result }
  stage.value = 'feedback'
}

function revise() {
  attempt.value = 2
  stage.value = 'write' // der Satz der 1. Fassung bleibt im Feld stehen und wird ueberarbeitet
}

function showModels() {
  stage.value = 'revealed'
}

function giveUp() {
  gaveUp.value = true
  stage.value = 'revealed'
  emit('completed', { stepId: props.step.stepId, status: 'gave-up', produce: produceDetails(null) })
}

function produceDetails(self) {
  const last = second.value ?? first.value
  const changed = Boolean(second.value) && squash(second.value.text) !== squash(first.value.text)
  return {
    checked: true,
    tries: second.value ? 2 : first.value ? 1 : 0,
    first: first.value?.result.outcome ?? null,
    final: last?.result.outcome ?? null,
    tags: last?.result.tags ?? [],
    improved: didImprove(first.value?.result, second.value?.result, { changed }),
    gaveUp: gaveUp.value,
    copied: Boolean(last?.result.copied),
    self,
  }
}

const COMPARISON_TEXT = {
  improved: 'Struktur im zweiten Versuch verbessert: Der Strukturcheck bestätigt jetzt die geprüften Merkmale. Das ist keine Grammatikbewertung – Verbformen und Rechtschreibung prüft er nicht.',
  partial: 'Teilfortschritt, kein Erfolg: Der Strukturcheck findet weniger sichere Hinweise, kann den Satz aber noch nicht bestätigen.',
  none: 'Keine messbare Verbesserung im Strukturcheck. Er prüft nur die Struktur – schau trotzdem, ob dir die 2. Fassung besser gefällt.',
}
const comparison = computed(() => {
  if (!second.value) return null
  const changed = squash(second.value.text) !== squash(first.value.text)
  return COMPARISON_TEXT[compareAttempts(first.value.result, second.value.result, { changed })]
})

// Alter Ablauf (Schritte ohne "check").
function reveal() {
  if (answer.value.trim() !== '') legacyRevealed.value = true
}

function choose(status) {
  if (selfAssessment.value) return
  selfAssessment.value = status
  if (guided.value) emit('completed', { stepId: props.step.stepId, status, produce: produceDetails(status) })
  else emit('completed', { stepId: props.step.stepId, status })
}
</script>

<template>
  <section v-if="guided" class="question-card coach-produce coach-guided" :data-stage="stage">
    <div class="question-meta"><span>Eigener Satz</span><span v-if="step.variant === 'transfer'">Transfer</span></div>
    <h2 lang="de">{{ step.prompt }}</h2>
    <p v-if="step.hint" class="coach-word-hint" lang="de"><strong>Wortschatz:</strong> {{ step.hint }}</p>

    <template v-if="stage === 'write'">
      <p v-if="attempt === 2" class="explanation" lang="de">Überarbeite deinen Satz. Deine 1. Fassung steht noch im Feld. Der Knopf zum Prüfen wird aktiv, sobald du etwas geändert hast.</p>
      <p v-else class="explanation" lang="de">Schreibe zuerst deinen eigenen Satz. Danach bekommst du einen Strukturcheck. Die Musterlösungen siehst du erst später.</p>
      <label class="visually-hidden" :for="`coach-answer-${step.stepId}`">Dein englischer Satz</label>
      <textarea
        :id="`coach-answer-${step.stepId}`"
        v-model="answer"
        class="coach-answer-input"
        rows="3"
        lang="en"
        autocomplete="off"
        autocapitalize="sentences"
        spellcheck="false"
        placeholder="Dein englischer Satz"
      />
      <div class="coach-actions">
        <button class="primary-button" type="button" :disabled="!canCheck" @click="check">{{ attempt === 1 ? 'Struktur prüfen' : '2. Fassung prüfen' }}</button>
        <button class="secondary-button" type="button" @click="giveUp">Lösung anzeigen (zählt nicht als gelöst)</button>
      </div>
    </template>

    <template v-else-if="stage === 'feedback'">
      <p class="coach-own-sentence"><strong>Deine {{ attempt }}. Fassung:</strong> <span lang="en">{{ current.text }}</span></p>
      <div class="feedback-box coach-structure" role="status">
        <h3 class="coach-outcome" :class="`coach-outcome-${current.result.outcome}`">{{ OUTCOME_TITLE[current.result.outcome] }}</h3>
        <p class="explanation" lang="de">{{ OUTCOME_NOTE[current.result.outcome] }}</p>
        <ul class="coach-structure-list" lang="de">
          <li v-for="entry in current.result.items" :key="entry.id" :class="`coach-check-${entry.state}`">
            <span class="coach-check-icon" aria-hidden="true">{{ STATE_ICON[entry.state] }}</span>
            <span class="visually-hidden">{{ STATE_WORD[entry.state] }}: </span>
            <strong>{{ entry.label }}</strong> – {{ entry.message }}
          </li>
        </ul>
        <p class="coach-not-checked" role="note" lang="de">Der Strukturcheck prüft <strong>nicht</strong>: {{ NOT_CHECKED.join('; ') }}. Prüfe diese Punkte selbst.</p>
      </div>

      <h3>Checkliste</h3>
      <ul class="coach-checklist">
        <li v-for="point in step.checklist" :key="point">{{ point }}</li>
      </ul>

      <div class="coach-actions">
        <template v-if="attempt === 1 && current.result.outcome === 'met'">
          <button class="primary-button" type="button" @click="showModels">Musterlösungen ansehen</button>
          <button class="secondary-button" type="button" @click="revise">Satz trotzdem überarbeiten</button>
        </template>
        <template v-else-if="attempt === 1 && current.result.outcome === 'unclear'">
          <button class="primary-button" type="button" @click="revise">Satz überarbeiten</button>
          <button class="secondary-button" type="button" @click="showModels">Musterlösungen ansehen</button>
        </template>
        <template v-else-if="attempt === 1">
          <button class="primary-button" type="button" @click="revise">Satz überarbeiten</button>
          <button class="secondary-button" type="button" @click="giveUp">Lösung anzeigen (zählt nicht als gelöst)</button>
        </template>
        <button v-else class="primary-button" type="button" @click="showModels">Musterlösungen ansehen</button>
      </div>
    </template>

    <div v-else class="feedback-box coach-compare">
      <template v-if="first">
        <h3>Deine Fassungen</h3>
        <ul class="coach-versions">
          <li><strong>1. Fassung:</strong> <span lang="en">{{ first.text }}</span> <em class="coach-version-outcome">({{ OUTCOME_TITLE[first.result.outcome] }})</em></li>
          <li v-if="second"><strong>2. Fassung:</strong> <span lang="en">{{ second.text }}</span> <em class="coach-version-outcome">({{ OUTCOME_TITLE[second.result.outcome] }})</em></li>
        </ul>
        <p v-if="comparison" class="explanation" lang="de">{{ comparison }}</p>
      </template>
      <p v-if="gaveUp" class="explanation coach-gave-up" role="note" lang="de">Du hast die Lösung direkt angezeigt. Das zählt nicht als gelöst – die Aufgabe kommt in der Wiederholung wieder dran.</p>
      <p v-else class="explanation coach-no-grade" role="note" lang="de">Auch der Strukturcheck ist keine Grammatikbewertung. Vergleiche deine Fassung mit der Checkliste und den Musterlösungen.</p>

      <h3>Checkliste</h3>
      <ul class="coach-checklist">
        <li v-for="point in step.checklist" :key="point">{{ point }}</li>
      </ul>

      <h3>Musterlösungen</h3>
      <p class="explanation" lang="de">Mehrere Formulierungen sind richtig.</p>
      <ul class="coach-model-answers">
        <li v-for="model in step.modelAnswers" :key="model" lang="en">{{ model }}</li>
      </ul>
      <div v-if="canPlaySolution" class="coach-example-audio">
        <AudioButton label="Musterlösung anhören" show-label @play="playSolution()" />
        <AudioButton label="Langsam" icon="🐢" show-label @play="playSolution({ slow: true })" />
      </div>

      <p class="explanation">{{ step.feedback }}</p>

      <template v-if="gaveUp">
        <button class="primary-button" type="button" @click="emit('next-item')">{{ isLastItem ? 'Abschließen' : 'Weiter' }}</button>
      </template>
      <div v-else-if="!selfAssessment" class="coach-self-assess" role="group" aria-label="Selbsteinschätzung">
        <p class="coach-self-assess-question">Wie gut passt dein Satz zur Checkliste? (Deine eigene Einschätzung – sie wird getrennt vom Strukturcheck gespeichert.)</p>
        <button v-for="choice in choices" :key="choice.status" type="button" class="secondary-button" @click="choose(choice.status)">{{ choice.label }}</button>
      </div>
      <template v-else>
        <p class="feedback-correct coach-self-assess-result">Gespeichert: {{ choices.find((choice) => choice.status === selfAssessment).label }}.</p>
        <button class="primary-button" type="button" @click="emit('next-item')">{{ isLastItem ? 'Abschließen' : 'Weiter' }}</button>
      </template>
    </div>
  </section>

  <section v-else class="question-card coach-produce">
    <div class="question-meta"><span>Eigener Satz</span></div>
    <h2 lang="de">{{ step.prompt }}</h2>

    <label class="visually-hidden" :for="`coach-answer-${step.stepId}`">Dein englischer Satz</label>
    <textarea
      :id="`coach-answer-${step.stepId}`"
      v-model="answer"
      class="coach-answer-input"
      rows="3"
      lang="en"
      autocomplete="off"
      autocapitalize="sentences"
      spellcheck="false"
      placeholder="Dein englischer Satz"
      :disabled="legacyRevealed"
    />
    <button v-if="!legacyRevealed" class="primary-button" type="button" :disabled="answer.trim() === ''" @click="reveal">Mit Musterlösung vergleichen</button>

    <div v-else class="feedback-box coach-compare">
      <p class="coach-own-sentence"><strong>Dein Satz:</strong> <span lang="en">{{ answer }}</span></p>
      <p class="explanation coach-no-grade" role="note">Dein Satz wird nicht automatisch bewertet. Prüfe ihn selbst anhand der Checkliste und vergleiche ihn mit der Musterlösung.</p>

      <h3>Checkliste</h3>
      <ul class="coach-checklist">
        <li v-for="point in step.checklist" :key="point">{{ point }}</li>
      </ul>

      <h3>Musterlösung</h3>
      <ul class="coach-model-answers">
        <li v-for="model in step.modelAnswers" :key="model" lang="en">{{ model }}</li>
      </ul>
      <div v-if="canPlaySolution" class="coach-example-audio">
        <AudioButton label="Musterlösung anhören" show-label @play="playSolution()" />
        <AudioButton label="Langsam" icon="🐢" show-label @play="playSolution({ slow: true })" />
      </div>

      <p class="explanation">{{ step.feedback }}</p>

      <div v-if="!selfAssessment" class="coach-self-assess" role="group" aria-label="Selbsteinschätzung">
        <p class="coach-self-assess-question">Wie gut passt dein Satz zur Checkliste?</p>
        <button v-for="choice in choices" :key="choice.status" type="button" class="secondary-button" @click="choose(choice.status)">{{ choice.label }}</button>
      </div>
      <template v-else>
        <p class="feedback-correct coach-self-assess-result">Gespeichert: {{ choices.find((choice) => choice.status === selfAssessment).label }}.</p>
        <button class="primary-button" type="button" @click="emit('next-item')">{{ isLastItem ? 'Abschließen' : 'Weiter' }}</button>
      </template>
    </div>
  </section>
</template>
