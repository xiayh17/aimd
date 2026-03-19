<script lang="ts">
import { defineComponent, h, type PropType, type VNode } from "vue"
import type { AimdStepNode, AimdCheckNode } from "@airalogy/aimd-core/types"
import type { AimdRecorderMessages } from "../locales"
import { getAimdRecorderScopeLabel } from "../locales"
import type { AimdStepOrCheckRecordItem } from "../types"

export const AimdStepField = defineComponent({
  name: "AimdStepField",
  props: {
    node: { type: Object as PropType<AimdStepNode>, required: true },
    state: { type: Object as PropType<AimdStepOrCheckRecordItem>, required: true },
    disabled: { type: Boolean, default: false },
    extraClasses: { type: Array as PropType<string[]>, default: () => [] },
    messages: { type: Object as PropType<AimdRecorderMessages>, required: true },
  },
  emits: ["check-change", "annotation-change", "blur"],
  setup(props, { emit }) {
    return () => {
      const node = props.node
      const id = node.id
      const state = props.state
      const stepNumber = node.step || "?"
      const disabled = props.disabled
      const extraClasses = props.extraClasses
      const isChecked = Boolean(state.checked)

      return h("span", {
        class: [
          "aimd-rec-step-card",
          isChecked ? "aimd-rec-step-card--checked" : "aimd-rec-step-card--awaiting",
          ...extraClasses,
        ],
      }, [
        // left accent bar
        h("span", { class: "aimd-rec-step-card__bar" }),
        // badge
        h("label", { class: "aimd-rec-step-card__badge-wrap" }, [
          h("input", {
            "data-rec-focus-key": `step:${id}:checked`,
            type: "checkbox",
            class: "aimd-rec-step-card__checkbox",
            disabled,
            checked: isChecked,
            onChange: (event: Event) => {
              emit("check-change", { id, value: (event.target as HTMLInputElement).checked })
            },
            onBlur: () => emit("blur", { id }),
          }),
          h("span", {
            class: ["aimd-rec-step-card__badge", isChecked ? "aimd-rec-step-card__badge--checked" : ""],
          }, [
            isChecked
              ? h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "3", width: "14", height: "14" }, [
                  h("polyline", { points: "20 6 9 17 4 12" }),
                ])
              : String(stepNumber),
          ]),
        ]),
        // content
        h("span", { class: "aimd-rec-step-card__content" }, [
          h("span", { class: "aimd-rec-step-card__title" }, id),
          h("input", {
            "data-rec-focus-key": `step:${id}:annotation`,
            class: "aimd-rec-step-card__annotation",
            disabled,
            placeholder: props.messages.step.annotationPlaceholder,
            value: state.annotation || "",
            onInput: (event: Event) => {
              emit("annotation-change", { id, value: (event.target as HTMLInputElement).value })
            },
            onBlur: () => emit("blur", { id }),
          }),
        ]),
      ])
    }
  },
})

export const AimdCheckField = defineComponent({
  name: "AimdCheckField",
  props: {
    node: { type: Object as PropType<AimdCheckNode>, required: true },
    state: { type: Object as PropType<AimdStepOrCheckRecordItem>, required: true },
    disabled: { type: Boolean, default: false },
    extraClasses: { type: Array as PropType<string[]>, default: () => [] },
    messages: { type: Object as PropType<AimdRecorderMessages>, required: true },
  },
  emits: ["check-change", "annotation-change", "blur"],
  setup(props, { emit }) {
    return () => {
      const node = props.node
      const id = node.id
      const state = props.state
      const disabled = props.disabled
      const extraClasses = props.extraClasses
      const isChecked = Boolean(state.checked)

      return h("span", {
        class: [
          "aimd-rec-step-card aimd-rec-step-card--check",
          isChecked ? "aimd-rec-step-card--checked" : "aimd-rec-step-card--awaiting",
          ...extraClasses,
        ],
      }, [
        h("span", { class: "aimd-rec-step-card__bar" }),
        h("label", { class: "aimd-rec-step-card__badge-wrap" }, [
          h("input", {
            "data-rec-focus-key": `check:${id}:checked`,
            type: "checkbox",
            class: "aimd-rec-step-card__checkbox",
            disabled,
            checked: isChecked,
            onChange: (event: Event) => {
              emit("check-change", { id, value: (event.target as HTMLInputElement).checked })
            },
            onBlur: () => emit("blur", { id }),
          }),
          h("span", {
            class: ["aimd-rec-step-card__badge aimd-rec-step-card__badge--check", isChecked ? "aimd-rec-step-card__badge--checked" : ""],
          }, [
            isChecked
              ? h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "3", width: "14", height: "14" }, [
                  h("polyline", { points: "20 6 9 17 4 12" }),
                ])
              : h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2.5", width: "14", height: "14" }, [
                  h("polyline", { points: "20 6 9 17 4 12" }),
                ]),
          ]),
        ]),
        h("span", { class: "aimd-rec-step-card__content" }, [
          h("span", { class: "aimd-rec-step-card__title" }, node.label || id),
          h("input", {
            "data-rec-focus-key": `check:${id}:annotation`,
            class: "aimd-rec-step-card__annotation",
            disabled,
            placeholder: props.messages.check.annotationPlaceholder,
            value: state.annotation || "",
            onInput: (event: Event) => {
              emit("annotation-change", { id, value: (event.target as HTMLInputElement).value })
            },
            onBlur: () => emit("blur", { id }),
          }),
        ]),
      ])
    }
  },
})

export default AimdStepField
</script>
