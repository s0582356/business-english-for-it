import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OrderedStepsTrainer from '../OrderedStepsTrainer.vue'

const item = {
  id: 'tel-ordered-01',
  type: 'ordered',
  intent: 'dialog-reconstruction',
  category: 'Business Telephoning',
  prompt: 'Bring these steps into the correct order.',
  steps: [
    { id: 'greet', label: 'Good morning, this is Mark Weber.' },
    { id: 'reason', label: 'I am calling about our meeting.' },
  ],
  correctOrder: ['greet', 'reason'],
  explanation: 'Eröffnung kommt vor dem Anliegen.',
  stepFeedback: { reason: 'Das Anliegen folgt erst nach der Vorstellung.' },
}

describe('OrderedStepsTrainer - Auswertung', () => {
  it('erkennt eine bereits korrekte Ausgangsreihenfolge', async () => {
    const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: false } })

    await wrapper.find('.primary-button').trigger('click')

    expect(wrapper.emitted('completed')[0][0]).toEqual({ id: 'tel-ordered-01', correct: true })
    expect(wrapper.find('.feedback-correct').exists()).toBe(true)
  })

  it('erkennt eine falsche Reihenfolge und zeigt Schritt-Feedback', async () => {
    const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: false } })

    // Reihenfolge vertauschen: "reason" per ▲ nach vorne schieben -> falsch
    const upButtons = wrapper.findAll('button[aria-label="Nach oben verschieben"]')
    await upButtons[1].trigger('click')
    await wrapper.find('.primary-button').trigger('click')

    expect(wrapper.emitted('completed')[0][0]).toEqual({ id: 'tel-ordered-01', correct: false })
    expect(wrapper.find('.feedback-wrong').exists()).toBe(true)
    expect(wrapper.text()).toContain('Das Anliegen folgt erst nach der Vorstellung.')
  })

  it('deaktiviert ▲ beim ersten und ▼ beim letzten Schritt', () => {
    const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: false } })
    const upButtons = wrapper.findAll('button[aria-label="Nach oben verschieben"]')
    const downButtons = wrapper.findAll('button[aria-label="Nach unten verschieben"]')
    expect(upButtons[0].attributes('disabled')).toBeDefined()
    expect(downButtons[downButtons.length - 1].attributes('disabled')).toBeDefined()
  })

  it('emittiert "finish" statt "next-item" beim letzten Item', async () => {
    const wrapper = mount(OrderedStepsTrainer, { props: { item, isLastItem: true } })
    await wrapper.find('.primary-button').trigger('click')

    expect(wrapper.text()).toContain('Ergebnis anzeigen')
    await wrapper.find('.feedback-box .primary-button').trigger('click')
    expect(wrapper.emitted('finish')).toBeTruthy()
    expect(wrapper.emitted('next-item')).toBeFalsy()
  })
})
