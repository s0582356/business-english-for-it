<script setup>
import { computed, ref, watch } from 'vue'
import { isAcceptedGapAnswer } from '../utils/gapAnswer.js'

const props = defineProps({ item: { type: Object, required: true }, isLastItem: { type: Boolean, required: true } })
const emit = defineEmits(['completed', 'next-item', 'finish'])
const answer = ref('')
const checked = ref(false)
const isMemoryHintOpen = ref(false)

watch(() => props.item, () => {
  answer.value = ''
  checked.value = false
  isMemoryHintOpen.value = false
})

const isCorrect = computed(() => isAcceptedGapAnswer(answer.value, props.item.acceptedAnswers))
const intentLabel = computed(() => props.item.intent ? props.item.intent.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : null)

function check() {
  if (checked.value) return
  checked.value = true
  emit('completed', { id: props.item.id, correct: isCorrect.value })
}

function nextItem() {
  emit(props.isLastItem ? 'finish' : 'next-item')
}
</script>

<template>
  <section class="question-card gap-input-trainer">
    <div class="question-meta"><span v-if="item.category">{{ item.category }}</span><span v-if="intentLabel">{{ intentLabel }}</span></div>
    <h2>{{ item.prompt }}</h2>
    <label class="visually-hidden" :for="`gap-answer-${item.id}`">Deine Antwort</label>
    <input :id="`gap-answer-${item.id}`" v-model="answer" class="gap-answer-input" type="text" autocomplete="off" :disabled="checked" placeholder="Deine Antwort" @keyup.enter="check">
    <button v-if="!checked" class="primary-button" type="button" @click="check">Antwort prüfen</button>
    <div v-if="checked" class="feedback-box">
      <p v-if="isCorrect" class="feedback-correct"><span aria-hidden="true">✓</span> Richtig.</p>
      <p v-else class="feedback-wrong"><span aria-hidden="true">✗</span> Nicht ganz.</p>
      <p v-if="!isCorrect" class="gap-model-answer">Mögliche Lösung: <strong>{{ item.acceptedAnswers[0] }}</strong></p>
      <p class="explanation">{{ item.explanation }}</p>
      <div v-if="item.memoryHint" class="memory-hint">
        <button class="memory-hint-toggle" type="button" :aria-expanded="isMemoryHintOpen" :aria-controls="`memory-hint-content-${item.id}`" @click="isMemoryHintOpen = !isMemoryHintOpen"><span>💡 So merkst du dir das</span><span class="memory-hint-icon" aria-hidden="true">{{ isMemoryHintOpen ? '−' : '+' }}</span></button>
        <div v-if="isMemoryHintOpen" :id="`memory-hint-content-${item.id}`" class="memory-hint-content">
          <div v-if="item.memoryHint.whyItFits" class="memory-hint-section"><h4>Warum passt das?</h4><p>{{ item.memoryHint.whyItFits }}</p></div>
          <div v-if="item.memoryHint.memoryHook" class="memory-hint-section"><h4>Merke</h4><p class="memory-hook">{{ item.memoryHint.memoryHook }}</p></div>
        </div>
      </div>
      <button class="primary-button" type="button" @click="nextItem">{{ isLastItem ? 'Ergebnis anzeigen' : 'Weiter' }}</button>
    </div>
  </section>
</template>
