import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GapInputTrainer from '../GapInputTrainer.vue'

const item = { id: 'synthetic-gap-01', type: 'gap', prompt: 'Synthetic prompt.', acceptedAnswers: ['Please send the file', 'Please send us the file'], explanation: 'Synthetic explanation.', memoryHint: { memoryHook: 'Synthetic hook.' } }

describe('GapInputTrainer', () => {
  it('shows correct feedback for a normalized answer', async () => {
    const wrapper = mount(GapInputTrainer, { props: { item, isLastItem: false } })
    await wrapper.find('.gap-answer-input').setValue('  please   send the file. ')
    await wrapper.find('.primary-button').trigger('click')
    expect(wrapper.find('.feedback-correct').exists()).toBe(true)
    expect(wrapper.emitted('completed')[0][0]).toEqual({ id: item.id, correct: true })
  })
  it('shows wrong feedback, first model answer, explanation and memory hint', async () => {
    const wrapper = mount(GapInputTrainer, { props: { item, isLastItem: false } })
    await wrapper.find('.gap-answer-input').setValue('Wrong answer')
    await wrapper.find('.primary-button').trigger('click')
    expect(wrapper.find('.feedback-wrong').exists()).toBe(true)
    expect(wrapper.text()).toContain(item.acceptedAnswers[0])
    expect(wrapper.text()).toContain(item.explanation)
    await wrapper.find('.memory-hint-toggle').trigger('click')
    expect(wrapper.text()).toContain(item.memoryHint.memoryHook)
  })
})
