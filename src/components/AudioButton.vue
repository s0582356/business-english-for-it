<script setup>
defineProps({
  label: { type: String, required: true },
  showLabel: { type: Boolean, default: false },
  icon: { type: String, default: '🔊' },
})

const emit = defineEmits(['play'])
</script>

<template>
  <button type="button" class="audio-button" :class="{ 'audio-button-labelled': showLabel }" :aria-label="label" @click="emit('play')">
    <span aria-hidden="true">{{ icon }}</span>
    <span v-if="showLabel" class="audio-button-label">{{ label }}</span>
  </button>
</template>
