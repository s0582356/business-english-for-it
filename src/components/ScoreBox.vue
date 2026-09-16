<script setup>
defineProps({
  currentItemIndex: {
    type: Number,
    required: true,
  },
  totalItems: {
    type: Number,
    required: true,
  },
  score: {
    type: Number,
    required: true,
  },
})
</script>

<template>
  <aside class="score-card" aria-label="Fortschritt in dieser Lernrunde">
    <h2>Fortschritt</h2>
    <p>Item {{ currentItemIndex + 1 }} von {{ totalItems }}</p>
    <p>Richtig: <strong>{{ score }}</strong></p>
  </aside>
</template>
