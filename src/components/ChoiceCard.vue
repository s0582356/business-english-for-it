<script setup>
import { computed, ref, watch } from 'vue'
import AnswerOption from './AnswerOption.vue'
import AudioButton from './AudioButton.vue'
import { useItemAudio } from '../utils/useItemAudio.js'

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  selectedAnswer: {
    type: String,
    default: null,
  },
  isAnswered: {
    type: Boolean,
    required: true,
  },
  isLastItem: {
    type: Boolean,
    required: true,
  },
})

const emit = defineEmits(['select-answer', 'next-item', 'finish'])

function shuffle(values) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[randomIndex]] = [result[randomIndex], result[index]]
  }
  return result
}

const displayedOptions = ref(shuffle(props.item.options))

watch(
  () => props.item,
  (item) => {
    displayedOptions.value = shuffle(item.options)
  },
)

function getAnswerClass(option) {
  if (!props.isAnswered) return ''
  if (option === props.item.correctAnswer) return 'answer-correct'
  if (option === props.selectedAnswer) return 'answer-wrong'
  return 'answer-muted'
}

const isCorrect = computed(() => props.selectedAnswer === props.item.correctAnswer)

const intentLabel = computed(() => {
  if (!props.item.intent) return null
  return props.item.intent
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
})

const { canPlayQuestion, canPlaySolution, playQuestion, playSolution } = useItemAudio(() => props.item, () => props.isAnswered)

const isMemoryHintOpen = ref(false)

watch(
  () => props.item,
  () => {
    isMemoryHintOpen.value = false
  },
)

function toggleMemoryHint() {
  isMemoryHintOpen.value = !isMemoryHintOpen.value
}
</script>

<template>
  <section class="question-card">
    <div class="question-meta">
      <span v-if="item.category">{{ item.category }}</span>
      <span v-if="intentLabel">{{ intentLabel }}</span>
    </div>

    <div class="prompt-row">
      <h2>{{ item.prompt }}</h2>
      <AudioButton v-if="canPlayQuestion" label="Frage anhören" @play="playQuestion" />
    </div>

    <div class="answers">
      <AnswerOption
        v-for="option in displayedOptions"
        :key="option"
        :option="option"
        :answer-class="getAnswerClass(option)"
        :is-disabled="isAnswered"
        @select="emit('select-answer', option)"
      />
    </div>

    <div v-if="isAnswered" class="feedback-box">
      <AudioButton v-if="canPlaySolution" label="Richtige Antwort anhören" show-label @play="playSolution" />

      <p v-if="isCorrect" class="feedback-correct">
        <span aria-hidden="true">✓</span> Richtig.
      </p>
      <p v-else class="feedback-wrong">
        <span aria-hidden="true">✗</span> Nicht ganz. Passender wäre:
        <strong>{{ item.correctAnswer }}</strong>
      </p>

      <p class="explanation">{{ item.explanation }}</p>

      <div v-if="item.memoryHint" class="memory-hint">
        <button
          class="memory-hint-toggle"
          type="button"
          :aria-expanded="isMemoryHintOpen"
          aria-controls="memory-hint-content"
          @click="toggleMemoryHint"
        >
          <span>💡 So merkst du dir das</span>
          <span class="memory-hint-icon" aria-hidden="true">{{ isMemoryHintOpen ? '−' : '+' }}</span>
        </button>

        <div v-if="isMemoryHintOpen" id="memory-hint-content" class="memory-hint-content">
          <div v-if="item.memoryHint.whyItFits" class="memory-hint-section">
            <h4>Warum passt das?</h4>
            <p>{{ item.memoryHint.whyItFits }}</p>
          </div>
          <div v-if="item.memoryHint.memoryHook" class="memory-hint-section">
            <h4>Merke</h4>
            <p class="memory-hook">{{ item.memoryHint.memoryHook }}</p>
          </div>
        </div>
      </div>

      <button
        v-if="!isLastItem"
        class="primary-button"
        type="button"
        @click="emit('next-item')"
      >
        Weiter
      </button>
      <button v-else class="primary-button" type="button" @click="emit('finish')">
        Ergebnis anzeigen
      </button>
    </div>
  </section>
</template>
