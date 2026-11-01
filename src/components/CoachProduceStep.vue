<script setup>
import { ref, watch } from 'vue'
import AudioButton from './AudioButton.vue'
import { useItemAudio } from '../utils/useItemAudio.js'

const props = defineProps({
  step: { type: Object, required: true },
  isLastItem: { type: Boolean, default: false },
})
const emit = defineEmits(['completed', 'next-item'])

// Der eigene Satz bleibt nur in dieser Ansicht (nicht gespeichert, nicht bewertet).
const answer = ref('')
const revealed = ref(false)
const selfAssessment = ref(null)

const { canPlaySolution, playSolution } = useItemAudio(() => props.step, () => revealed.value)

watch(() => props.step, () => {
  answer.value = ''
  revealed.value = false
  selfAssessment.value = null
})

const choices = [
  { status: 'self-ok', label: 'Passt zur Checkliste' },
  { status: 'self-almost', label: 'Fast – kleine Fehler' },
  { status: 'self-again', label: 'Nochmal üben' },
]

function reveal() {
  if (answer.value.trim() !== '') revealed.value = true
}

function choose(status) {
  if (selfAssessment.value) return
  selfAssessment.value = status
  emit('completed', { stepId: props.step.stepId, status })
}
</script>

<template>
  <section class="question-card coach-produce">
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
      :disabled="revealed"
    />
    <button v-if="!revealed" class="primary-button" type="button" :disabled="answer.trim() === ''" @click="reveal">Mit Musterlösung vergleichen</button>

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
