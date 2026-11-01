<script setup>
import AudioButton from './AudioButton.vue'
import { useItemAudio } from '../utils/useItemAudio.js'

const props = defineProps({ example: { type: Object, required: true } })

// Kein Auto-Vorlesen: mehrere Zeilen stehen gleichzeitig auf dem Bildschirm, gespielt wird nur per Tipp.
const { canPlayQuestion, playQuestion } = useItemAudio(() => props.example, () => true, { autoplay: false })
</script>

<template>
  <li class="coach-example">
    <div class="coach-example-text">
      <p class="coach-example-en" lang="en">{{ example.en }}</p>
      <p class="coach-example-de" lang="de">{{ example.de }}</p>
      <p v-if="example.level || example.note" class="coach-example-note">
        <strong v-if="example.level">{{ example.level }}</strong><span v-if="example.level && example.note"> · </span><span v-if="example.note">{{ example.note }}</span>
      </p>
    </div>
    <div v-if="canPlayQuestion" class="coach-example-audio">
      <AudioButton label="Satz anhören" @play="playQuestion()" />
      <AudioButton label="Langsam" icon="🐢" show-label @play="playQuestion({ slow: true })" />
    </div>
  </li>
</template>
