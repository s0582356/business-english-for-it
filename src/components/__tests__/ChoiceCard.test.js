import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChoiceCard from '../ChoiceCard.vue'

const item = {
  id: 'tel-open-01',
  type: 'choice',
  intent: 'telephone-opening',
  category: 'Business Telephoning',
  prompt: 'Which is more professional?',
  options: ['This is Laura Kim speaking.', 'Hi, it is me.'],
  correctAnswer: 'This is Laura Kim speaking.',
  explanation: 'Weil der Name klar genannt wird.',
  memoryHint: { whyItFits: 'Namen gehen am Telefon leicht unter.', memoryHook: 'This is ... speaking.' },
}

describe('ChoiceCard - Auswertung', () => {
  it('emittiert beim Klick genau die geklickte Option (Optionen werden bewusst gemischt)', async () => {
    const wrapper = mount(ChoiceCard, {
      props: { item, selectedAnswer: null, isAnswered: false, isLastItem: false },
    })

    const buttons = wrapper.findAll('.answer-button')
    expect(buttons.map((button) => button.text()).sort()).toEqual([...item.options].sort())

    const correctButton = buttons.find((button) => button.text() === item.correctAnswer)
    await correctButton.trigger('click')

    expect(wrapper.emitted('select-answer')[0]).toEqual([item.correctAnswer])
  })

  it('zeigt bei richtiger Antwort das Erfolgsfeedback inkl. Erklärung', async () => {
    const wrapper = mount(ChoiceCard, {
      props: { item, selectedAnswer: item.correctAnswer, isAnswered: true, isLastItem: false },
    })

    expect(wrapper.find('.feedback-correct').exists()).toBe(true)
    expect(wrapper.find('.feedback-wrong').exists()).toBe(false)
    expect(wrapper.text()).toContain(item.explanation)
  })

  it('zeigt bei falscher Antwort die passende Formulierung und markiert die Optionen korrekt', () => {
    const wrapper = mount(ChoiceCard, {
      props: { item, selectedAnswer: 'Hi, it is me.', isAnswered: true, isLastItem: false },
    })

    expect(wrapper.find('.feedback-wrong').exists()).toBe(true)
    expect(wrapper.text()).toContain(item.correctAnswer)

    const buttons = wrapper.findAll('.answer-button')
    const correctButton = buttons.find((button) => button.text() === item.correctAnswer)
    const wrongButton = buttons.find((button) => button.text() === 'Hi, it is me.')
    expect(correctButton.classes()).toContain('answer-correct')
    expect(wrongButton.classes()).toContain('answer-wrong')
  })

  it('zeigt den Merksatz nur nach Aufklappen und nur wenn memoryHint vorhanden ist', async () => {
    const wrapper = mount(ChoiceCard, {
      props: { item, selectedAnswer: item.correctAnswer, isAnswered: true, isLastItem: false },
    })

    expect(wrapper.find('.memory-hint-content').exists()).toBe(false)
    await wrapper.find('.memory-hint-toggle').trigger('click')
    expect(wrapper.find('.memory-hint-content').exists()).toBe(true)
    expect(wrapper.text()).toContain(item.memoryHint.memoryHook)
  })

  it('zeigt keinen Merksatz-Block, wenn kein memoryHint gesetzt ist', () => {
    const itemWithoutHint = { ...item, memoryHint: null }
    const wrapper = mount(ChoiceCard, {
      props: { item: itemWithoutHint, selectedAnswer: item.correctAnswer, isAnswered: true, isLastItem: false },
    })

    expect(wrapper.find('.memory-hint').exists()).toBe(false)
  })

  it('emittiert "finish" statt "next-item" beim letzten Item', async () => {
    const wrapper = mount(ChoiceCard, {
      props: { item, selectedAnswer: item.correctAnswer, isAnswered: true, isLastItem: true },
    })

    expect(wrapper.text()).toContain('Ergebnis anzeigen')
    await wrapper.find('.primary-button').trigger('click')
    expect(wrapper.emitted('finish')).toBeTruthy()
    expect(wrapper.emitted('next-item')).toBeFalsy()
  })
})
