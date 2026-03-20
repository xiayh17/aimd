<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, reactive, ref, watch, type PropType, type VNode, type VNodeChild } from "vue"
import type {
  AimdCheckNode,
  AimdClientAssignerField,
  AimdQuizField,
  AimdQuizNode,
  AimdStepNode,
  AimdVarNode,
  AimdVarTableNode,
  ExtractedAimdFields,
} from "@airalogy/aimd-core/types"
import { parseAndExtract, renderToVue } from "@airalogy/aimd-renderer"
import type { AimdComponentRenderer } from "@airalogy/aimd-renderer"
import type { AimdRecorderMessagesInput } from "../locales"
import {
  createAimdRecorderMessages,
  resolveAimdRecorderLocale,
} from "../locales"
import type {
  AimdFieldMeta,
  AimdFieldState,
  AimdRecorderFieldAdapters,
  AimdTypePlugin,
  AimdProtocolRecordData,
  AimdStepDetailDisplay,
  AimdStepRecordItem,
  FieldEventPayload,
  TableEventPayload,
} from "../types"
import { createEmptyProtocolRecordData } from "../types"
import {
  applyIncomingRecord,
  applyPastedVarTableGrid,
  cloneRecordData,
  ensureDefaultsFromFields,
  getRecordDataSignature,
  getQuizDefaultValue,
  parsePastedVarTableText,
} from "../composables/useRecordState"
import {
  getVarInputKind,
  normalizeVarTypeName,
  normalizeDateTimeValueWithTimezone,
} from "../composables/useVarHelpers"
import {
  captureFocusSnapshot,
  restoreFocusSnapshot,
} from "../composables/useFocusManagement"
import type { FocusSnapshot } from "../composables/useFocusManagement"
import { useClientAssignerRunner } from "../composables/useClientAssignerRunner"
import { resolveAimdRecorderFieldVNode } from "../composables/useFieldAdapters"
import { useVarTableDragDrop, getVarTableColumns } from "../composables/useVarTableDragDrop"
import { useFieldRendering } from "../composables/useFieldRendering"
import {
  createEmptyCheckRecordItem,
  createEmptyStepRecordItem,
  formatStepDuration,
  getProtocolEstimatedDurationMs,
  getProtocolRecordedDurationMs,
  isStepTimerRunning,
  pauseStepTimer,
  resetStepTimer,
  setStepChecked,
  startStepTimer,
} from "../composables/useStepTimers"
import { createAimdTypePlugins } from "../type-plugins"
import AimdVarField from "./AimdVarField.vue"
import AimdVarTableField from "./AimdVarTableField.vue"
import { AimdStepField, AimdCheckField } from "./AimdStepCheckField.vue"
import AimdQuizRecorder from "./AimdQuizRecorder.vue"

// ---------------------------------------------------------------------------
// Props & emits
// ---------------------------------------------------------------------------

const props = withDefaults(defineProps<{
  /** AIMD markdown content to render */
  content: string
  /** Current record data (v-model) */
  modelValue?: Partial<AimdProtocolRecordData>
  /** When true all inputs are read-only */
  readonly?: boolean
  /** Used to pre-fill currenttime / username fields */
  currentUserName?: string
  now?: Date | string | number
  locale?: string
  messages?: AimdRecorderMessagesInput
  /** Controls whether step timer / note details stay expanded */
  stepDetailDisplay?: AimdStepDetailDisplay

  // ── Extension props ──────────────────────────────────────────────────────

  /**
   * Per-field metadata keyed by "section:fieldName" (e.g. "var:temp").
   * Controls inputType overrides, assigner mode, enum options, etc.
   */
  fieldMeta?: Record<string, AimdFieldMeta>

  /**
   * Per-field runtime state keyed by "section:fieldName".
   * Drives loading / error / validationError styling.
   */
  fieldState?: Record<string, AimdFieldState>

  /**
   * Optional wrapper applied to every rendered field VNode.
   * Receives (fieldKey, fieldType, defaultVNode) and should return a VNode.
   * Use to inject assigner buttons, dependency tags, validation errors, etc.
   */
  wrapField?: (fieldKey: string, fieldType: string, defaultVNode: VNode) => VNode

  /**
   * Renderer overrides keyed by AIMD field type ("var", "step", …).
   * Return null/undefined to fall through to the built-in renderer.
   */
  customRenderers?: Partial<Record<string, AimdComponentRenderer>>

  /**
   * Host-level field adapters with full recorder context.
   * Prefer this over `customRenderers` for new integrations.
   */
  fieldAdapters?: AimdRecorderFieldAdapters

  /**
   * Resolves relative paths / Airalogy file IDs to displayable URLs.
   * Reserved for future file-type field support.
   */
  resolveFile?: (src: string) => string | null

  /**
   * Type-level plugins for custom var types.
   * Plugins can define initialization, normalization, display, parsing, and full custom field widgets.
   */
  typePlugins?: AimdTypePlugin[]
}>(), {
  modelValue: undefined,
  readonly: false,
  currentUserName: undefined,
  now: undefined,
  locale: undefined,
  messages: undefined,
  stepDetailDisplay: "auto",
  fieldMeta: undefined,
  fieldState: undefined,
  wrapField: undefined,
  customRenderers: undefined,
  fieldAdapters: undefined,
  resolveFile: undefined,
  typePlugins: undefined,
})

const emit = defineEmits<{
  /** Full record updated (v-model) */
  (e: "update:modelValue", value: AimdProtocolRecordData): void
  /** Extracted field list changed (content reparsed) */
  (e: "fields-change", fields: ExtractedAimdFields): void
  /** Parse / render error */
  (e: "error", message: string): void

  // ── Granular field events ─────────────────────────────────────────────────
  /** A single field value changed */
  (e: "field-change", payload: FieldEventPayload): void
  /** A field lost focus — use to trigger external validation */
  (e: "field-blur", payload: FieldEventPayload): void

  // ── Assigner events ───────────────────────────────────────────────────────
  /** Host app should run assigner calculation for the given field */
  (e: "assigner-request", payload: FieldEventPayload): void
  /** Host app should cancel an in-flight assigner for the given field */
  (e: "assigner-cancel", payload: FieldEventPayload): void

  // ── Table events ──────────────────────────────────────────────────────────
  /** A table row was added */
  (e: "table-add-row", payload: TableEventPayload): void
  /** A table row was removed */
  (e: "table-remove-row", payload: TableEventPayload): void
}>()

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const inlineNodes = ref<VNode[]>([])
const renderError = ref("")
const contentRoot = ref<HTMLElement | null>(null)
const localRecord = reactive<AimdProtocolRecordData>(createEmptyProtocolRecordData())
let buildRequestId = 0
let inlineBuildRequestId = 0
let syncingFromExternal = false
let renderScheduled = false
let recordInitializedDuringRender = false
let pendingFocusSnapshot: FocusSnapshot | null = null
let pendingInlineBuildRequestId: number | null = null
const timerNowMs = ref(Date.now())
let protocolTimerTicker: ReturnType<typeof setInterval> | null = null

const resolvedLocale = computed(() => resolveAimdRecorderLocale(props.locale))
const resolvedMessages = computed(() => createAimdRecorderMessages(resolvedLocale.value, props.messages))
const resolvedTypePlugins = computed(() => createAimdTypePlugins(props.typePlugins))

const InlineNodesOutlet = defineComponent({
  name: "AimdRecorderInlineNodesOutlet",
  props: {
    nodes: {
      type: Array as PropType<VNode[]>,
      required: true,
    },
  },
  setup(outletProps) {
    return () => outletProps.nodes
  },
})

function applyFieldAdapter<TFieldType extends "var" | "var_table" | "step" | "check" | "quiz">(
  fieldType: TFieldType,
  fieldKey: string,
  node: any,
  value: unknown,
  defaultVNode: VNode,
): VNode {
  return resolveAimdRecorderFieldVNode(fieldType, fieldKey, node, value, defaultVNode, {
    fieldAdapters: props.fieldAdapters,
    wrapField: props.wrapField,
    readonly: props.readonly,
    locale: resolvedLocale.value,
    messages: resolvedMessages.value,
    record: localRecord,
    fieldMeta: props.fieldMeta,
    fieldState: props.fieldState,
  })
}

const EMPTY_FIELDS: ExtractedAimdFields = {
  var: [],
  var_table: [],
  client_assigner: [],
  quiz: [],
  step: [],
  check: [],
  ref_step: [],
  ref_var: [],
  ref_fig: [],
  cite: [],
  fig: [],
}

const extractedFields = ref<ExtractedAimdFields>(EMPTY_FIELDS)
const clientAssigners = ref<AimdClientAssignerField[]>([])
const protocolEstimatedDurationMs = computed(() => getProtocolEstimatedDurationMs(extractedFields.value.step_hierarchy ?? []))
const protocolRecordedDurationMs = computed(() => getProtocolRecordedDurationMs(localRecord.step, timerNowMs.value))
const showProtocolTimingSummary = computed(() => protocolEstimatedDurationMs.value > 0 || protocolRecordedDurationMs.value > 0)
const protocolEstimatedDurationLabel = computed(() => formatStepDuration(protocolEstimatedDurationMs.value, resolvedLocale.value))
const protocolRecordedDurationLabel = computed(() => formatStepDuration(protocolRecordedDurationMs.value, resolvedLocale.value))
const hasRunningStepTimer = computed(() => Object.values(localRecord.step).some(step => isStepTimerRunning(step)))

function syncProtocolTimerTicker() {
  if (protocolTimerTicker) {
    clearInterval(protocolTimerTicker)
    protocolTimerTicker = null
  }

  if (!hasRunningStepTimer.value) {
    return
  }

  protocolTimerTicker = setInterval(() => {
    timerNowMs.value = Date.now()
  }, 1000)
}

function getStepTimerPayload(step: AimdStepRecordItem) {
  return {
    elapsed_ms: step.elapsed_ms,
    timer_started_at_ms: step.timer_started_at_ms,
    started_at_ms: step.started_at_ms,
    ended_at_ms: step.ended_at_ms,
  }
}

function emitRecordUpdate() {
  if (syncingFromExternal) return
  emit("update:modelValue", cloneRecordData(localRecord))
}

function scheduleInlineRebuild() {
  pendingFocusSnapshot = captureFocusSnapshot(contentRoot.value) ?? pendingFocusSnapshot
  pendingInlineBuildRequestId = ++inlineBuildRequestId
  if (renderScheduled) {
    return
  }
  renderScheduled = true
  Promise.resolve().then(() => {
    renderScheduled = false
    const focusSnapshot = pendingFocusSnapshot
    const inlineRequestId = pendingInlineBuildRequestId ?? inlineBuildRequestId
    pendingFocusSnapshot = null
    pendingInlineBuildRequestId = null
    void rebuildInlineNodes(undefined, focusSnapshot, inlineRequestId)
  })
}

function markRecordChanged(options?: { rebuild?: boolean, runClientAssigners?: boolean }) {
  const assignerChanged = options?.runClientAssigners ? assignerRunner.applyCurrentClientAssigners() : false
  emitRecordUpdate()
  if (options?.rebuild || assignerChanged) {
    scheduleInlineRebuild()
  }
}

// ---------------------------------------------------------------------------
// Composables
// ---------------------------------------------------------------------------

const assignerRunner = useClientAssignerRunner({
  readonly: () => props.readonly,
  clientAssigners,
  localRecord,
  onError: (message) => emit("error", message),
  emitRecordUpdate,
  scheduleInlineRebuild,
})

const tableDragDrop = useVarTableDragDrop({
  readonly: () => props.readonly,
  localRecord,
  markRecordChanged,
  scheduleInlineRebuild,
  emitTableAddRow: (payload) => emit("table-add-row", payload),
  emitTableRemoveRow: (payload) => emit("table-remove-row", payload),
})

const fieldRendering = useFieldRendering({
  readonly: () => props.readonly,
  currentUserName: () => props.currentUserName,
  now: () => props.now,
  fieldMeta: () => props.fieldMeta,
  fieldState: () => props.fieldState,
  typePlugins: () => resolvedTypePlugins.value,
  wrapField: () => props.wrapField,
})

function isGroupedStepBodyNode(node: unknown): node is VNode {
  if (!node || typeof node !== "object") {
    return false
  }

  const props = (node as VNode).props as Record<string, unknown> | null | undefined
  if (!props) {
    return false
  }

  const classValue = props.class
  const classNames = Array.isArray(classValue)
    ? classValue
    : typeof classValue === "string"
      ? [classValue]
      : []

  return props["data-aimd-step-body"] === "true"
    || props["data-aimd-step-body"] === true
    || props.dataAimdStepBody === "true"
    || props.dataAimdStepBody === true
    || classNames.some((className) => typeof className === "string" && className.includes("aimd-step-body"))
}

function normalizeStepBodyNodes(bodyNodes: VNodeChild[] = []): VNodeChild[] {
  if (bodyNodes.length === 0) {
    return []
  }

  const groupedBody = bodyNodes.find((child) => isGroupedStepBodyNode(child))
  if (!groupedBody || typeof groupedBody !== "object" || groupedBody === null) {
    return bodyNodes
  }

  const groupedChildren = (groupedBody as VNode).children
  if (Array.isArray(groupedChildren)) {
    return groupedChildren as VNodeChild[]
  }

  if (groupedChildren == null) {
    return []
  }

  return [groupedChildren as VNodeChild]
}

// ---------------------------------------------------------------------------
// Inline field renderers
// ---------------------------------------------------------------------------

function renderInlineVar(node: AimdVarNode): VNode {
  const id = node.id
  const fieldKey = `var:${id}`
  const meta = props.fieldMeta?.[fieldKey]

  // 1. Custom renderer override
  if (props.customRenderers?.var) {
    const custom = props.customRenderers.var(node, {} as any, [])
    if (custom) return applyFieldAdapter("var", fieldKey, node, localRecord.var[id], custom as VNode)
  }

  const type = node.definition?.type || "str"
  const typePlugin = fieldRendering.getTypePlugin(fieldKey, type)
  const inputKind = getVarInputKind(type, {
    inputType: meta?.inputType,
    codeLanguage: meta?.codeLanguage,
    typePlugin,
  })
  const placeholder = meta?.placeholder ?? fieldRendering.getVarPlaceholder(node)

  function emitVarChange(value: unknown) {
    fieldRendering.clearVarInputDisplayOverride(id)
    localRecord.var[id] = value
    markRecordChanged({ runClientAssigners: true })
    emit("field-change", { section: "var", fieldKey: id, value })
  }

  function emitVarBlur() {
    emit("field-blur", { section: "var", fieldKey: id })
  }

  // 2. Initialise value
  if (!(id in localRecord.var)) {
    localRecord.var[id] = fieldRendering.getVarInitialValue(node, type, fieldKey)
    const initialDisplayOverride = fieldRendering.getVarInitialDisplayOverride(node, type, fieldKey)
    if (initialDisplayOverride) {
      fieldRendering.setVarInputDisplayOverride(id, initialDisplayOverride)
    }
    recordInitializedDuringRender = true
  }
  if (inputKind === "datetime") {
    const norm = normalizeDateTimeValueWithTimezone(localRecord.var[id])
    if (norm !== localRecord.var[id]) {
      localRecord.var[id] = norm
      recordInitializedDuringRender = true
    }
  }
  const normalizedValue = fieldRendering.normalizeVarValue(
    node,
    type,
    fieldKey,
    localRecord.var[id],
    inputKind,
  )
  if (JSON.stringify(normalizedValue) !== JSON.stringify(localRecord.var[id])) {
    localRecord.var[id] = normalizedValue
    recordInitializedDuringRender = true
  }

  const displayValue = fieldRendering.getVarDisplayValue(
    id,
    node,
    type,
    localRecord.var[id],
    inputKind,
    fieldKey,
  )
  const disabled = fieldRendering.isFieldDisabled(fieldKey)
  const extraClasses = fieldRendering.fieldStateClasses(fieldKey)

  if (typePlugin?.renderField) {
    const pluginVNode = typePlugin.renderField({
      type,
      normalizedType: normalizeVarTypeName(type),
      fieldKey,
      node,
      value: localRecord.var[id],
      inputKind,
      fieldMeta: meta,
      currentUserName: props.currentUserName,
      now: props.now,
      readonly: props.readonly,
      disabled,
      locale: resolvedLocale.value,
      messages: resolvedMessages.value,
      record: localRecord,
      displayValue,
      extraClasses,
      placeholder,
      fieldState: props.fieldState?.[fieldKey],
      emitChange: emitVarChange,
      emitBlur: emitVarBlur,
    })

    if (pluginVNode) {
      return applyFieldAdapter("var", fieldKey, node, localRecord.var[id], pluginVNode)
    }
  }

  const vnode = h(AimdVarField, {
    node,
    value: localRecord.var[id] as any,
    disabled,
    extraClasses,
    messages: resolvedMessages.value,
    fieldMeta: meta,
    displayValue,
    inputKind,
    typePlugin,
    initialized: id in localRecord.var,
    onChange: (payload: { id: string, value: unknown, type: string, inputKind: string }) => {
      emitVarChange(payload.value)
    },
    onBlur: () => emitVarBlur(),
  })

  return applyFieldAdapter("var", fieldKey, node, localRecord.var[id], vnode)
}

function renderInlineVarTable(node: AimdVarTableNode): VNode {
  const tableName = node.id
  const fieldKey = `var_table:${tableName}`
  const columns = getVarTableColumns(node)
  const rows = tableDragDrop.ensureVarTableRows(tableName, columns)
  const disabled = fieldRendering.isFieldDisabled(fieldKey)
  const disabledColumns = columns.filter(column => !!props.fieldMeta?.[`var_table:${tableName}:${column}`]?.disabled)

  const vnode = h(AimdVarTableField, {
    node,
    rows,
    columns,
    disabled,
    readonly: props.readonly,
    settlingRowKey: tableDragDrop.getSettlingVarTableRowKey(),
    messages: resolvedMessages.value,
    fieldMeta: props.fieldMeta,
    fieldState: props.fieldState,
    onCellInput: (payload: { tableName: string, column: string, rowIndex: number, value: string, row: Record<string, string> }) => {
      payload.row[payload.column] = payload.value
      markRecordChanged({ runClientAssigners: true })
      emit("field-change", {
        section: "var_table",
        fieldKey: `${payload.tableName}:${payload.column}`,
        value: payload.value,
      })
    },
    onCellPaste: (payload: { tableName: string, column: string, rowIndex: number, text: string }) => {
      const startColumnIndex = columns.indexOf(payload.column)
      if (startColumnIndex < 0) {
        return
      }

      const pastedGrid = parsePastedVarTableText(payload.text)
      const result = applyPastedVarTableGrid(
        rows,
        columns,
        payload.rowIndex,
        startColumnIndex,
        pastedGrid,
        { disabledColumns },
      )

      if (result.rowsAdded === 0 && result.changedCells.length === 0) {
        return
      }

      // Var tables are rendered through rebuilt inline VNodes, so pasted updates
      // need a refresh even when they only overwrite existing cells.
      markRecordChanged({ rebuild: true, runClientAssigners: true })
      for (let index = 0; index < result.rowsAdded; index += 1) {
        emit("table-add-row", { tableName: payload.tableName, columns })
      }
      for (const cell of result.changedCells) {
        emit("field-change", {
          section: "var_table",
          fieldKey: `${payload.tableName}:${cell.column}`,
          value: cell.value,
        })
      }
    },
    onCellBlur: (payload: { tableName: string, column: string }) => {
      emit("field-blur", { section: "var_table", fieldKey: `${payload.tableName}:${payload.column}` })
    },
    onAddRow: (payload: { tableName: string, columns: string[] }) => {
      tableDragDrop.addVarTableRow(payload.tableName, payload.columns)
    },
    onRemoveRow: (payload: { tableName: string, rowIndex: number, columns: string[] }) => {
      tableDragDrop.removeVarTableRow(payload.tableName, payload.rowIndex, payload.columns)
    },
    onDragStart: (payload: { tableName: string, rowIndex: number, event: DragEvent }) => {
      tableDragDrop.startVarTableRowDrag(payload.tableName, payload.rowIndex, payload.event)
    },
    onDragOver: (payload: { tableName: string, rowIndex: number, event: DragEvent }) => {
      tableDragDrop.handleVarTableRowDragOver(payload.tableName, payload.rowIndex, payload.event)
    },
    onDragDrop: (payload: { tableName: string, rowIndex: number, columns: string[], event: DragEvent }) => {
      tableDragDrop.handleVarTableRowDrop(payload.tableName, payload.rowIndex, payload.columns, payload.event)
    },
    onDragEnd: () => {
      tableDragDrop.endVarTableRowDrag()
    },
  })

  return applyFieldAdapter("var_table", fieldKey, node, rows, vnode)
}

function renderInlineStep(node: AimdStepNode, bodyNodes: VNodeChild[] = []): VNode {
  const id = node.id
  const fieldKey = `step:${id}`
  if (!(id in localRecord.step)) {
    localRecord.step[id] = createEmptyStepRecordItem()
    recordInitializedDuringRender = true
  }

  const state = localRecord.step[id]
  const disabled = fieldRendering.isFieldDisabled(fieldKey)
  const extraClasses = fieldRendering.fieldStateClasses(fieldKey)
  const normalizedBodyNodes = normalizeStepBodyNodes(bodyNodes)

  const headerVnode = h(AimdStepField, {
    node,
    state,
    bodyNodes: normalizedBodyNodes,
    disabled,
    extraClasses,
    detailDisplay: props.stepDetailDisplay,
    locale: resolvedLocale.value,
    messages: resolvedMessages.value,
    onCheckChange: (payload: { id: string, value: boolean }) => {
      const wasRunning = isStepTimerRunning(state)
      setStepChecked(state, payload.value, Date.now())
      timerNowMs.value = Date.now()
      markRecordChanged()
      emit("field-change", { section: "step", fieldKey: payload.id, value: payload.value })
      if (wasRunning) {
        emit("field-change", { section: "step", fieldKey: `${payload.id}:timer`, value: getStepTimerPayload(state) })
      }
    },
    onAnnotationChange: (payload: { id: string, value: string }) => {
      state.annotation = payload.value
      markRecordChanged()
      emit("field-change", { section: "step", fieldKey: `${payload.id}:annotation`, value: payload.value })
    },
    onTimerStart: (payload: { id: string }) => {
      if (!startStepTimer(state, Date.now())) {
        return
      }
      timerNowMs.value = Date.now()
      markRecordChanged()
      emit("field-change", { section: "step", fieldKey: `${payload.id}:timer`, value: getStepTimerPayload(state) })
    },
    onTimerPause: (payload: { id: string }) => {
      if (!pauseStepTimer(state, Date.now())) {
        return
      }
      timerNowMs.value = Date.now()
      markRecordChanged()
      emit("field-change", { section: "step", fieldKey: `${payload.id}:timer`, value: getStepTimerPayload(state) })
    },
    onTimerReset: (payload: { id: string }) => {
      if (!resetStepTimer(state)) {
        return
      }
      timerNowMs.value = Date.now()
      markRecordChanged()
      emit("field-change", { section: "step", fieldKey: `${payload.id}:timer`, value: getStepTimerPayload(state) })
    },
    onBlur: (payload: { id: string }) => {
      emit("field-blur", { section: "step", fieldKey: payload.id })
    },
  })

  const cardVnode = h("div", {
    class: [
      "aimd-step-card-block",
      `aimd-step-card-block--level-${node.level || 1}`,
      !node.check ? "aimd-step-card-block--passive" : "",
      Boolean(state.checked) ? "aimd-step-card-block--checked" : "",
    ],
    "data-aimd-step-card": id,
  }, [
    h("div", { class: "aimd-step-card-block__header" }, [headerVnode]),
    bodyNodes.length > 0
      ? h("div", { class: "aimd-step-card-block__body" }, bodyNodes)
      : null,
  ])

  return applyFieldAdapter("step", fieldKey, node, state, cardVnode)
}

function renderInlineCheck(node: AimdCheckNode): VNode {
  const id = node.id
  const fieldKey = `check:${id}`
  if (!(id in localRecord.check)) {
    localRecord.check[id] = createEmptyCheckRecordItem()
    recordInitializedDuringRender = true
  }

  const state = localRecord.check[id]
  const disabled = fieldRendering.isFieldDisabled(fieldKey)
  const extraClasses = fieldRendering.fieldStateClasses(fieldKey)

  const vnode = h(AimdCheckField, {
    node,
    state,
    disabled,
    extraClasses,
    messages: resolvedMessages.value,
    onCheckChange: (payload: { id: string, value: boolean }) => {
      state.checked = payload.value
      markRecordChanged()
      emit("field-change", { section: "check", fieldKey: payload.id, value: payload.value })
    },
    onAnnotationChange: (payload: { id: string, value: string }) => {
      state.annotation = payload.value
      markRecordChanged()
      emit("field-change", { section: "check", fieldKey: `${payload.id}:annotation`, value: payload.value })
    },
    onBlur: (payload: { id: string }) => {
      emit("field-blur", { section: "check", fieldKey: payload.id })
    },
  })

  return applyFieldAdapter("check", fieldKey, node, state, vnode)
}

function renderInlineQuiz(node: AimdQuizNode): VNode {
  const quizId = node.id
  const fieldKey = `quiz:${quizId}`
  const quizField = {
    id: quizId,
    type: node.quizType,
    stem: node.stem,
    mode: node.mode,
    options: node.options,
    blanks: node.blanks,
    default: node.default,
    rubric: node.rubric,
    score: node.score,
    extra: node.extra,
  } as AimdQuizField

  if (!(quizId in localRecord.quiz)) {
    localRecord.quiz[quizId] = getQuizDefaultValue(quizField)
  }

  const vnode = h(AimdQuizRecorder, {
    class: "aimd-rec-inline aimd-rec-inline--quiz",
    quiz: quizField,
    modelValue: localRecord.quiz[quizId],
    readonly: props.readonly,
    focusKeyPrefix: `quiz:${quizId}`,
    locale: resolvedLocale.value,
    messages: props.messages,
    "onUpdate:modelValue": (value: unknown) => {
      localRecord.quiz[quizId] = value
      markRecordChanged()
      emit("field-change", { section: "quiz", fieldKey: quizId, value })
    },
  })

  return applyFieldAdapter("quiz", fieldKey, node, localRecord.quiz[quizId], vnode)
}

// ---------------------------------------------------------------------------
// Rebuild pipeline
// ---------------------------------------------------------------------------

async function rebuildInlineNodes(
  expectedRequestId?: number,
  focusSnapshot?: FocusSnapshot | null,
  expectedInlineRequestId?: number,
) {
  recordInitializedDuringRender = false
  const rendered = await renderToVue(props.content || "", {
    locale: resolvedLocale.value,
    context: {
      mode: "edit",
      readonly: props.readonly,
      value: localRecord as Record<string, Record<string, unknown>>,
    },
    blockVarTypes: ["AiralogyMarkdown"],
    groupStepBodies: true,
    aimdRenderers: {
      var: node => renderInlineVar(node as AimdVarNode),
      var_table: node => renderInlineVarTable(node as AimdVarTableNode),
      step: (node, _ctx, children) => renderInlineStep(node as AimdStepNode, children),
      check: node => renderInlineCheck(node as AimdCheckNode),
      quiz: node => renderInlineQuiz(node as AimdQuizNode),
    },
  })

  if (
    (expectedRequestId !== undefined && expectedRequestId !== buildRequestId)
    || (expectedInlineRequestId !== undefined && expectedInlineRequestId !== inlineBuildRequestId)
  ) {
    return
  }

  inlineNodes.value = rendered.nodes
  await nextTick()
  restoreFocusSnapshot(contentRoot.value, focusSnapshot ?? null)

  if (recordInitializedDuringRender) emitRecordUpdate()
}

async function parseAndBuild() {
  const currentRequestId = ++buildRequestId
  const currentInlineRequestId = ++inlineBuildRequestId
  try {
    renderError.value = ""
    const extracted = parseAndExtract(props.content || "")
    if (currentRequestId !== buildRequestId) return

    extractedFields.value = extracted
    clientAssigners.value = extracted.client_assigner || []
    emit("fields-change", extracted)

    const defaultsChanged = ensureDefaultsFromFields(localRecord, extracted)
    const assignerChanged = assignerRunner.applyCurrentClientAssigners()
    if (defaultsChanged || assignerChanged) {
      emitRecordUpdate()
    }

    await rebuildInlineNodes(currentRequestId, undefined, currentInlineRequestId)
  } catch (error) {
    if (currentRequestId !== buildRequestId) {
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    renderError.value = message
    inlineNodes.value = []
    extractedFields.value = EMPTY_FIELDS
    clientAssigners.value = []
    emit("fields-change", EMPTY_FIELDS)
    emit("error", message)
  }
}

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

watch(
  () => props.modelValue,
  (value) => {
    const shouldRebuild = getRecordDataSignature(value) !== getRecordDataSignature(localRecord)
    if (!shouldRebuild) {
      return
    }
    syncingFromExternal = true
    applyIncomingRecord(localRecord, value)
    syncingFromExternal = false
    const assignerChanged = assignerRunner.applyCurrentClientAssigners()
    if (assignerChanged) {
      emitRecordUpdate()
    }
    if (shouldRebuild || assignerChanged) {
      scheduleInlineRebuild()
    }
  },
  { deep: true, immediate: true },
)

watch(hasRunningStepTimer, () => {
  timerNowMs.value = Date.now()
  syncProtocolTimerTicker()
}, { immediate: true })

watch(
  () => ({
    content: props.content,
    locale: props.locale,
    messages: props.messages,
  }),
  () => {
    void parseAndBuild()
  },
  { immediate: true, deep: true },
)

onBeforeUnmount(() => {
  if (protocolTimerTicker) {
    clearInterval(protocolTimerTicker)
  }
})

defineExpose({
  runClientAssigner: assignerRunner.triggerClientAssigner,
  runManualClientAssigners: assignerRunner.triggerManualClientAssigners,
})
</script>

<template>
  <div class="aimd-protocol-recorder">
    <div v-if="renderError" class="aimd-protocol-recorder__error">{{ renderError }}</div>

    <template v-else>
      <div v-if="showProtocolTimingSummary" class="aimd-protocol-recorder__timing">
        <span
          v-if="protocolEstimatedDurationMs > 0"
          class="aimd-protocol-recorder__timing-pill aimd-protocol-recorder__timing-pill--estimate"
        >
          {{ resolvedMessages.step.protocolEstimatedTotal(protocolEstimatedDurationLabel) }}
        </span>
        <span
          v-if="protocolRecordedDurationMs > 0"
          class="aimd-protocol-recorder__timing-pill"
        >
          {{ resolvedMessages.step.protocolRecordedTotal(protocolRecordedDurationLabel) }}
        </span>
      </div>

      <div v-if="inlineNodes.length" ref="contentRoot" class="aimd-protocol-recorder__content">
        <InlineNodesOutlet :nodes="inlineNodes" />
      </div>

      <div v-else class="aimd-protocol-recorder__empty">{{ resolvedMessages.common.emptyContent }}</div>
    </template>
  </div>
</template>

<style scoped>
.aimd-protocol-recorder {
  --rec-text: #253041;
  --rec-muted: #667085;
  --rec-border: #e3e8ef;
  --rec-focus: #2f6fed;
  --rec-error: #e03050;
  --rec-var-control-height: 30px;
  --rec-var-single-line-height: 1.2;
  --rec-var-text-wrap-line-height: 1.35;
}

.aimd-protocol-recorder__error {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #f4b3c1;
  background: #fff3f6;
  color: #b4234d;
  font-size: 13px;
}

.aimd-protocol-recorder__timing {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.aimd-protocol-recorder__timing-pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid #d5dde8;
  border-radius: 999px;
  background: #f8fafc;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
}

.aimd-protocol-recorder__timing-pill--estimate {
  border-color: #f1d39a;
  background: #fff8ea;
  color: #9a5800;
}

.aimd-protocol-recorder__content {
  max-width: 980px;
  margin: 0 auto;
  padding: clamp(22px, 3vw, 30px);
  border: 1px solid var(--rec-border);
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgba(226, 232, 240, 0.38), transparent 28%),
    linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 10px 30px rgba(15, 23, 42, 0.03);
  color: var(--rec-text);
  line-height: 1.78;
}

.aimd-protocol-recorder__empty {
  padding: 24px;
  border: 1px dashed #d7dbe3;
  border-radius: 8px;
  color: #7b8595;
  text-align: center;
}

/* ── Typography ─────────────────────────────────────────────────────────── */
.aimd-protocol-recorder__content :deep(h1) {
  margin: 0.25em 0 0.65em;
  color: #172033;
  font-size: clamp(1.75rem, 2.6vw, 2.05rem);
  line-height: 1.18;
  letter-spacing: -0.02em;
}
.aimd-protocol-recorder__content :deep(h2) {
  margin: 1.55em 0 0.65em;
  color: #172033;
  font-size: clamp(1.3rem, 2vw, 1.5rem);
  line-height: 1.24;
  letter-spacing: -0.015em;
}
.aimd-protocol-recorder__content :deep(h3) {
  margin: 1.25em 0 0.5em;
  color: #223047;
  font-size: 1.12rem;
  line-height: 1.32;
}
.aimd-protocol-recorder__content :deep(h4) {
  margin: 1.05em 0 0.45em;
  color: #334155;
  font-size: 0.98rem;
  line-height: 1.35;
}
.aimd-protocol-recorder__content :deep(p) {
  margin: 0.72em 0;
  color: var(--rec-text);
}
.aimd-protocol-recorder__content :deep(ul),
.aimd-protocol-recorder__content :deep(ol) {
  margin: 0.7em 0 0.95em;
  padding-left: 1.5rem;
}
.aimd-protocol-recorder__content :deep(li) {
  margin: 0.32em 0;
  padding-left: 0.15rem;
}
.aimd-protocol-recorder__content :deep(li + li) {
  margin-top: 0.42em;
}
.aimd-protocol-recorder__content :deep(hr) {
  height: 1px;
  margin: 1.8em 0 1.5em;
  border: 0;
  background: linear-gradient(90deg, rgba(148, 163, 184, 0), rgba(148, 163, 184, 0.7) 18%, rgba(148, 163, 184, 0.18) 100%);
}
.aimd-protocol-recorder__content :deep(table) {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  margin: 1em 0 1.25em;
  font-size: 14px;
  overflow: hidden;
  border: 1px solid #d9e2ec;
  border-radius: 12px;
}
.aimd-protocol-recorder__content :deep(th),
.aimd-protocol-recorder__content :deep(td) {
  border-bottom: 1px solid #e2e8f0;
  padding: 9px 12px;
  text-align: left;
  vertical-align: top;
}
.aimd-protocol-recorder__content :deep(tr:last-child td) {
  border-bottom: 0;
}
.aimd-protocol-recorder__content :deep(th) {
  background: #f8fafc;
  color: #475569;
  font-weight: 700;
}
.aimd-protocol-recorder__content :deep(pre) {
  margin: 1em 0 1.25em;
  padding: 14px 16px;
  overflow-x: auto;
  border: 1px solid #d9e2ec;
  border-radius: 14px;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
}
.aimd-protocol-recorder__content :deep(pre code) {
  padding: 0;
  border: 0;
  background: transparent;
  color: #0f172a;
  box-shadow: none;
}
.aimd-protocol-recorder__content :deep(code) {
  padding: 0.14em 0.45em;
  border: 1px solid #d5dde7;
  border-radius: 6px;
  background: #eef4ff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
  color: #174ea6;
  font-size: 0.92em;
}
.aimd-protocol-recorder__content :deep(blockquote:not(.aimd-callout)) {
  margin: 1em 0 1.25em;
  padding: 0.35em 0 0.35em 1.05em;
  border-left: 3px solid #cbd5e1;
  color: #475569;
  background: transparent;
}
.aimd-protocol-recorder__content :deep(blockquote:not(.aimd-callout) > :first-child) {
  margin-top: 0;
}
.aimd-protocol-recorder__content :deep(blockquote:not(.aimd-callout) > :last-child) {
  margin-bottom: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-callout) {
  position: relative;
  margin: 1.25em 0 1.55em;
  padding: 16px 18px 18px 22px;
  border: 1px solid #d7e5dc;
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(248, 252, 249, 0.98) 0%, rgba(242, 247, 244, 0.98) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 8px 20px rgba(15, 23, 42, 0.04);
  color: #334155;
}
.aimd-protocol-recorder__content :deep(.aimd-callout::before) {
  content: "";
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 0;
  width: 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, #16a34a 0%, #0f766e 100%);
}
.aimd-protocol-recorder__content :deep(details.aimd-callout) {
  overflow: hidden;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__title) {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0 0 0.85em;
  padding-bottom: 0.8em;
  border-bottom: 1px solid rgba(15, 118, 110, 0.12);
  color: #14532d;
  font-weight: 700;
  line-height: 1.45;
}
.aimd-protocol-recorder__content :deep(summary.aimd-callout__title) {
  list-style: none;
}
.aimd-protocol-recorder__content :deep(summary.aimd-callout__title::-webkit-details-marker) {
  display: none;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__title--interactive) {
  cursor: pointer;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__title--badge-only) {
  margin-bottom: 0.7em;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge) {
  display: inline-flex;
  align-items: center;
  gap: 0.48rem;
  min-height: 30px;
  padding: 0.3rem 0.75rem 0.3rem 0.42rem;
  border: 1px solid rgba(15, 118, 110, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge-icon) {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  color: currentColor;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge-icon::before),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge-icon::after) {
  content: "";
  position: absolute;
  box-sizing: border-box;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge-label) {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 1;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__title-text) {
  color: inherit;
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__toggle) {
  margin-left: auto;
  width: 0.65rem;
  height: 0.65rem;
  border-right: 1.8px solid currentColor;
  border-bottom: 1.8px solid currentColor;
  transform: rotate(45deg);
  transition: transform 0.18s ease;
}
.aimd-protocol-recorder__content :deep(details.aimd-callout[open] .aimd-callout__toggle) {
  transform: rotate(225deg);
}
.aimd-protocol-recorder__content :deep(.aimd-callout__title > :first-child),
.aimd-protocol-recorder__content :deep(.aimd-callout__body > :first-child) {
  margin-top: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__body > :last-child) {
  margin-bottom: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-callout p) {
  color: #334155;
}
.aimd-protocol-recorder__content :deep(.aimd-callout strong) {
  color: #0f3d2e;
  font-weight: 700;
}
.aimd-protocol-recorder__content :deep(.aimd-callout ul),
.aimd-protocol-recorder__content :deep(.aimd-callout ol) {
  margin: 0.6em 0 0.2em;
  padding-left: 1.75rem;
}
.aimd-protocol-recorder__content :deep(.aimd-callout li + li) {
  margin-top: 0.5em;
}
.aimd-protocol-recorder__content :deep(.aimd-callout code) {
  background: #f4f8f6;
  border-color: #d2e1d7;
  color: #166534;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--note) {
  border-color: #d8e3f0;
  background: linear-gradient(180deg, rgba(248, 251, 255, 0.98) 0%, rgba(241, 246, 253, 0.98) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--note::before) {
  background: linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--note .aimd-callout__title) {
  border-bottom-color: rgba(37, 99, 235, 0.14);
  color: #1e3a8a;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--note .aimd-callout__badge) {
  border-color: rgba(37, 99, 235, 0.16);
  color: #1d4ed8;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--info) {
  border-color: #d9e3ee;
  background: linear-gradient(180deg, rgba(248, 251, 254, 0.98) 0%, rgba(242, 247, 252, 0.98) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--info::before) {
  background: linear-gradient(180deg, #0891b2 0%, #0e7490 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--info .aimd-callout__title) {
  border-bottom-color: rgba(8, 145, 178, 0.14);
  color: #155e75;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--info .aimd-callout__badge) {
  border-color: rgba(8, 145, 178, 0.16);
  color: #0e7490;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--abstract) {
  border-color: #dde4ef;
  background: linear-gradient(180deg, rgba(250, 251, 253, 0.98) 0%, rgba(244, 247, 251, 0.98) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--abstract::before) {
  background: linear-gradient(180deg, #475569 0%, #334155 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--abstract .aimd-callout__title) {
  border-bottom-color: rgba(71, 85, 105, 0.14);
  color: #334155;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--abstract .aimd-callout__badge) {
  border-color: rgba(71, 85, 105, 0.16);
  color: #475569;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--example) {
  border-color: #dbe7d6;
  background: linear-gradient(180deg, rgba(249, 252, 247, 0.98) 0%, rgba(243, 248, 240, 0.98) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--example::before) {
  background: linear-gradient(180deg, #65a30d 0%, #4d7c0f 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--example .aimd-callout__title) {
  border-bottom-color: rgba(77, 124, 15, 0.14);
  color: #3f6212;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--example .aimd-callout__badge) {
  border-color: rgba(77, 124, 15, 0.16);
  color: #4d7c0f;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--tip) {
  border-color: #d7e5dc;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--tip .aimd-callout__badge) {
  border-color: rgba(22, 163, 74, 0.16);
  color: #15803d;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--success) {
  border-color: #d6eadc;
  background: linear-gradient(180deg, rgba(247, 253, 249, 0.98) 0%, rgba(239, 249, 242, 0.98) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--success::before) {
  background: linear-gradient(180deg, #16a34a 0%, #15803d 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--success .aimd-callout__title) {
  border-bottom-color: rgba(21, 128, 61, 0.14);
  color: #166534;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--success .aimd-callout__badge) {
  border-color: rgba(21, 128, 61, 0.16);
  color: #15803d;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--important) {
  border-color: #e8dcf8;
  background: linear-gradient(180deg, rgba(251, 248, 255, 0.98) 0%, rgba(246, 241, 253, 0.98) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--important::before) {
  background: linear-gradient(180deg, #7c3aed 0%, #6d28d9 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--important .aimd-callout__title) {
  border-bottom-color: rgba(109, 40, 217, 0.14);
  color: #5b21b6;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--important .aimd-callout__badge) {
  border-color: rgba(109, 40, 217, 0.16);
  color: #6d28d9;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--warning) {
  border-color: #f1dfc9;
  background: linear-gradient(180deg, rgba(255, 250, 242, 0.98) 0%, rgba(253, 245, 234, 0.98) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--warning::before) {
  background: linear-gradient(180deg, #f59e0b 0%, #d97706 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--warning .aimd-callout__title) {
  border-bottom-color: rgba(217, 119, 6, 0.16);
  color: #92400e;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--warning .aimd-callout__badge) {
  border-color: rgba(217, 119, 6, 0.16);
  color: #b45309;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--danger) {
  border-color: #f2d3d6;
  background: linear-gradient(180deg, rgba(255, 247, 247, 0.98) 0%, rgba(253, 240, 241, 0.98) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--danger::before) {
  background: linear-gradient(180deg, #dc2626 0%, #b91c1c 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--danger .aimd-callout__title) {
  border-bottom-color: rgba(185, 28, 28, 0.14);
  color: #991b1b;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--danger .aimd-callout__badge) {
  border-color: rgba(185, 28, 28, 0.16);
  color: #b91c1c;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--caution) {
  border-color: #f0d4d8;
  background: linear-gradient(180deg, rgba(255, 248, 248, 0.98) 0%, rgba(253, 242, 243, 0.98) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--caution::before) {
  background: linear-gradient(180deg, #ef4444 0%, #dc2626 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--caution .aimd-callout__title) {
  border-bottom-color: rgba(220, 38, 38, 0.14);
  color: #991b1b;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--caution .aimd-callout__badge) {
  border-color: rgba(220, 38, 38, 0.16);
  color: #dc2626;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--bug) {
  border-color: #ead8db;
  background: linear-gradient(180deg, rgba(252, 248, 248, 0.98) 0%, rgba(246, 239, 240, 0.98) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--bug::before) {
  background: linear-gradient(180deg, #be123c 0%, #9f1239 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--bug .aimd-callout__title) {
  border-bottom-color: rgba(159, 18, 57, 0.14);
  color: #881337;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--bug .aimd-callout__badge) {
  border-color: rgba(159, 18, 57, 0.16);
  color: #9f1239;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--quote) {
  border-color: #e5e7eb;
  background: linear-gradient(180deg, rgba(251, 251, 250, 0.98) 0%, rgba(246, 246, 244, 0.98) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--quote::before) {
  background: linear-gradient(180deg, #78716c 0%, #57534e 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--quote .aimd-callout__title) {
  border-bottom-color: rgba(87, 83, 78, 0.14);
  color: #44403c;
}
.aimd-protocol-recorder__content :deep(.aimd-callout.aimd-callout--quote .aimd-callout__badge) {
  border-color: rgba(87, 83, 78, 0.16);
  color: #57534e;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="note"] .aimd-callout__badge-icon::before),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="info"] .aimd-callout__badge-icon::before) {
  inset: 2px;
  border: 1.7px solid currentColor;
  border-radius: 999px;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="note"] .aimd-callout__badge-icon::after),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="info"] .aimd-callout__badge-icon::after) {
  top: 8px;
  left: 8px;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="tip"] .aimd-callout__badge-icon::before),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="spark"] .aimd-callout__badge-icon::before) {
  inset: 3px;
  border: 1.7px solid currentColor;
  border-radius: 5px;
  transform: rotate(45deg);
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="tip"] .aimd-callout__badge-icon::after),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="spark"] .aimd-callout__badge-icon::after) {
  top: 8px;
  left: 8px;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="example"] .aimd-callout__badge-icon::before) {
  top: 4px;
  left: 4px;
  width: 12px;
  height: 12px;
  border: 1.7px dashed currentColor;
  border-radius: 4px;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="example"] .aimd-callout__badge-icon::after) {
  top: 8px;
  left: 8px;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="important"] .aimd-callout__badge-icon::before) {
  inset: 2px;
  border: 1.8px solid currentColor;
  border-radius: 4px;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="important"] .aimd-callout__badge-icon::after) {
  top: 4px;
  left: 9px;
  width: 2px;
  height: 10px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 12px 0 0 currentColor;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="warning"] .aimd-callout__badge-icon::before) {
  inset: 2px;
  background: currentColor;
  clip-path: polygon(50% 4%, 96% 92%, 4% 92%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="warning"] .aimd-callout__badge-icon::after) {
  top: 7px;
  left: 9px;
  width: 2px;
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8px 0 0 rgba(255, 255, 255, 0.96);
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="triangle-alert"] .aimd-callout__badge-icon::before),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="danger"] .aimd-callout__badge-icon::before) {
  inset: 2px;
  background: currentColor;
  clip-path: polygon(50% 4%, 96% 92%, 4% 92%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="triangle-alert"] .aimd-callout__badge-icon::after),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="danger"] .aimd-callout__badge-icon::after) {
  top: 7px;
  left: 9px;
  width: 2px;
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8px 0 0 rgba(255, 255, 255, 0.96);
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="success"] .aimd-callout__badge-icon::before),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="check-circle"] .aimd-callout__badge-icon::before) {
  inset: 2px;
  border: 1.7px solid currentColor;
  border-radius: 999px;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="success"] .aimd-callout__badge-icon::after),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="check-circle"] .aimd-callout__badge-icon::after) {
  top: 7px;
  left: 6px;
  width: 7px;
  height: 4px;
  border-left: 1.9px solid currentColor;
  border-bottom: 1.9px solid currentColor;
  transform: rotate(-45deg);
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="caution"] .aimd-callout__badge-icon::before) {
  inset: 2px;
  border: 1.7px solid currentColor;
  clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="caution"] .aimd-callout__badge-icon::after) {
  top: 5px;
  left: 9px;
  width: 2px;
  height: 10px;
  border-radius: 999px;
  background: currentColor;
  transform: rotate(45deg);
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="bug"] .aimd-callout__badge-icon::before),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="bug-outline"] .aimd-callout__badge-icon::before) {
  top: 5px;
  left: 5px;
  width: 10px;
  height: 10px;
  border: 1.7px solid currentColor;
  border-radius: 4px;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="bug"] .aimd-callout__badge-icon::after),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="bug-outline"] .aimd-callout__badge-icon::after) {
  top: 2px;
  left: 8px;
  width: 4px;
  height: 4px;
  border: 1.7px solid currentColor;
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
  box-shadow:
    -6px 7px 0 -5px currentColor,
    6px 7px 0 -5px currentColor,
    -6px 11px 0 -5px currentColor,
    6px 11px 0 -5px currentColor;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="quote"] .aimd-callout__badge-icon::before),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="quote-mark"] .aimd-callout__badge-icon::before) {
  top: 5px;
  left: 4px;
  width: 4px;
  height: 8px;
  border-radius: 4px 4px 4px 0;
  border: 1.7px solid currentColor;
  border-right: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="quote"] .aimd-callout__badge-icon::after),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="quote-mark"] .aimd-callout__badge-icon::after) {
  top: 5px;
  left: 12px;
  width: 4px;
  height: 8px;
  border-radius: 4px 4px 4px 0;
  border: 1.7px solid currentColor;
  border-right: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="abstract"] .aimd-callout__badge-icon::before),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="document"] .aimd-callout__badge-icon::before) {
  top: 2px;
  left: 4px;
  width: 12px;
  height: 16px;
  border: 1.7px solid currentColor;
  border-radius: 3px;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="abstract"] .aimd-callout__badge-icon::after),
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="document"] .aimd-callout__badge-icon::after) {
  top: 6px;
  left: 7px;
  width: 6px;
  height: 1.7px;
  background: currentColor;
  box-shadow: 0 4px 0 0 currentColor, 0 8px 0 0 currentColor;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="bookmark"] .aimd-callout__badge-icon::before) {
  top: 2px;
  left: 5px;
  width: 10px;
  height: 15px;
  border: 1.7px solid currentColor;
  border-bottom: 0;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 75%, 0 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="beaker"] .aimd-callout__badge-icon::before) {
  top: 3px;
  left: 6px;
  width: 8px;
  height: 4px;
  border: 1.7px solid currentColor;
  border-bottom: 0;
  border-radius: 2px 2px 0 0;
}
.aimd-protocol-recorder__content :deep(.aimd-callout__badge[data-aimd-callout-icon="beaker"] .aimd-callout__badge-icon::after) {
  top: 6px;
  left: 4px;
  width: 12px;
  height: 11px;
  border: 1.7px solid currentColor;
  border-top: 0;
  clip-path: polygon(18% 0, 82% 0, 100% 100%, 0 100%);
}

/* ── Field base ─────────────────────────────────────────────────────────── */
.aimd-protocol-recorder__content :deep(.aimd-field) {
  border-radius: 10px;
  margin: 6px 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85);
}
.aimd-protocol-recorder__content :deep(.aimd-field__scope) {
  border-radius: 6px;
  padding: 1px 7px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.01em;
  text-transform: lowercase;
}

/* ── Field colours ──────────────────────────────────────────────────────── */
.aimd-protocol-recorder__content :deep(.aimd-field--var) { background: #f3f8ff; border-color: #c9dcff; color: #1c4e90; }
.aimd-protocol-recorder__content :deep(.aimd-field--var .aimd-field__scope) { background: #dceaff; color: #255eab; }
.aimd-protocol-recorder__content :deep(.aimd-field--step) { background: #fff9ef; border-color: #f4d9a8; color: #9a5800; }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--step > .aimd-step-field__main .aimd-rec-inline__check-wrap > .aimd-field__scope) { background: #ffe8bf; color: #9a5800; }
.aimd-protocol-recorder__content :deep(.aimd-field--check) { background: #f8fafc; border-color: #d8dfe8; color: #2b3443; padding: 3px 8px; }
.aimd-protocol-recorder__content :deep(.aimd-field--check .aimd-field__scope) { background: #e7ecf3; color: #4f5f77; }
.aimd-protocol-recorder__content :deep(.aimd-field--var-table) {
  background: #fff;
  border: 1px solid #e2e8f0;
  color: #334155;
  border-radius: 12px;
  padding: 10px 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.aimd-protocol-recorder__content :deep(.aimd-field--var-table .aimd-field__scope) {
  background: #f8fafc;
  color: #64748b;
}
/* ── Error & loading ────────────────────────────────────────────────────── */
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--error) { border-color: var(--rec-error) !important; }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--error:focus-within) { box-shadow: 0 0 0 2px rgba(224, 48, 80, 0.12); }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--loading) { opacity: 0.6; pointer-events: none; }
.aimd-protocol-recorder__content :deep(.aimd-rec-table-cell-input--error) { border-color: var(--rec-error) !important; }

/* ── Inline layout ──────────────────────────────────────────────────────── */
.aimd-protocol-recorder__content :deep(.aimd-rec-inline) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 5px 3px;
  vertical-align: middle;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-multiline) { align-items: flex-start; }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked) {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  margin: 8px 0 10px;
  padding-top: 0.38rem;
  width: fit-content;
  min-width: 0;
  max-width: 100%;
  border: 0 none;
  border-radius: 0;
  overflow: visible;
  box-shadow: none;
  background: transparent;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked--textarea) { min-width: 0; }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked--checkbox) { width: fit-content; min-width: 0; }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked:focus-within) {
  border-color: transparent;
  box-shadow: none;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked .aimd-field) { margin: 0; box-shadow: none; }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked .aimd-field--no-style.aimd-field__label) {
  position: absolute;
  top: 0.08rem;
  right: 0.15rem;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 0;
  min-height: 0;
  max-width: min(18rem, calc(100% - 0.7rem));
  padding: 0.18rem 0.55rem;
  border: 1px solid rgba(203, 213, 225, 0.95);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 6px 18px rgba(15, 23, 42, 0.05);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-82%) scale(0.98);
  transform-origin: top right;
  transition:
    opacity 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked .aimd-field__scope) {
  display: none;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked .aimd-field__id) {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  min-width: 0;
  max-width: 16rem;
  padding: 0;
  color: #8a96a8;
  font-size: 0.68rem;
  font-weight: 500;
  font-family: "SFMono-Regular", "JetBrains Mono", ui-monospace, monospace;
  letter-spacing: 0.015em;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  opacity: 1;
  transition: color 0.18s ease;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked:hover .aimd-field--no-style.aimd-field__label),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked:focus-within .aimd-field--no-style.aimd-field__label) {
  opacity: 1;
  transform: translateY(-108%) scale(1);
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked:hover .aimd-field__id),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked:focus-within .aimd-field__id) {
  color: #64748b;
}
.aimd-protocol-recorder__content :deep(.aimd-step-card-block__body .aimd-rec-inline--var-stacked) {
  padding-top: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-step-card-block__body .aimd-rec-inline--var-stacked .aimd-field--no-style.aimd-field__label) {
  display: none;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-markdown) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
  width: min(100%, 1040px);
  max-width: 100%;
  margin: 14px 0 16px;
  vertical-align: top;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var-stacked--code) {
  width: min(100%, 980px);
  min-width: min(420px, 100%);
  max-width: 100%;
  margin: 12px 0;
  vertical-align: top;
}

/* ── Stacked input controls ─────────────────────────────────────────────── */
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__input--stacked) {
  width: 100%;
  min-width: 0;
  height: var(--rec-var-control-height);
  font-family: inherit;
  font-size: inherit;
  line-height: var(--rec-var-single-line-height);
  border: 1px solid #d7dee8;
  border-radius: 10px;
  margin: 0;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 1px 2px rgba(15, 23, 42, 0.04);
  padding: 0 12px;
  background: #fff;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__input--stacked:focus) {
  border-color: #94a3b8;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 0 0 3px rgba(148, 163, 184, 0.16);
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__textarea--stacked:not(.aimd-rec-inline__textarea--stacked-text)) {
  width: 100%;
  min-width: 0;
  min-height: 82px;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  border: 1px solid #d7dee8;
  border-radius: 10px;
  margin: 0;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 1px 2px rgba(15, 23, 42, 0.04);
  padding: 9px 12px;
  background: #fff;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__textarea--stacked-text) {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: var(--rec-var-control-height);
  font-family: inherit;
  font-size: inherit;
  line-height: var(--rec-var-text-wrap-line-height);
  border: 1px solid #d7dee8;
  border-radius: 10px;
  margin: 0;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 1px 2px rgba(15, 23, 42, 0.04);
  padding: 7px 12px;
  background: #fff;
  box-sizing: border-box;
  resize: none;
  overflow: hidden;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__textarea--stacked:focus) {
  border-color: #94a3b8;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 0 0 3px rgba(148, 163, 184, 0.16);
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__checkbox-row) {
  display: flex;
  align-items: center;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid #d7dee8;
  border-radius: 10px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 1px 2px rgba(15, 23, 42, 0.04);
  background: #fff;
}

/* ── Select ─────────────────────────────────────────────────────────────── */
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__select) {
  appearance: auto;
  cursor: pointer;
  height: var(--rec-var-control-height);
  padding: 0 12px;
  background: #fff;
}

/* ── Step / check ───────────────────────────────────────────────────────── */
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--step),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--check) { gap: 8px; }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--step) {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  width: min(100%, 1040px);
  max-width: 100%;
  margin: 16px 0;
  padding: 14px 16px 16px;
  border: 1px solid #f1d6a1;
  border-radius: 18px;
  background: #fff;
  box-shadow: none;
  color: var(--rec-text);
}
.aimd-protocol-recorder__content :deep(.aimd-step-field__main) {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px 14px;
  min-width: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-step-field__main-meta) {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-step-field__main-actions) {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.aimd-protocol-recorder__content :deep(.aimd-step-field__body) {
  min-width: 0;
  color: var(--rec-text);
  font-size: 15px;
  line-height: 1.72;
}
.aimd-protocol-recorder__content :deep(.aimd-step-field__body .aimd-step-body) {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.aimd-protocol-recorder__content :deep(.aimd-step-field__body p) {
  margin: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-step-field__details) {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding-top: 12px;
  border-top: 1px solid rgba(154, 88, 0, 0.12);
}
.aimd-protocol-recorder__content :deep(.aimd-step-field__detail--timer) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-step-field__detail--annotation) {
  display: flex;
  width: 100%;
  min-width: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--quiz) { display: block; margin: 12px 0; padding: 0; border: none; background: transparent; }

/* ── Step card block ────────────────────────────────────────────────────── */
.aimd-protocol-recorder__content :deep(.aimd-step-card-block) {
  display: block;
  margin: 16px 0;
  border: 1px solid #dbe3ec;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  overflow: hidden;
  box-shadow:
    0 2px 8px rgba(0,0,0,0.04),
    0 12px 24px rgba(15, 23, 42, 0.03);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
}
.aimd-protocol-recorder__content :deep(.aimd-step-card-block:hover) {
  border-color: #cdd8e4;
  box-shadow:
    0 4px 12px rgba(15, 23, 42, 0.05),
    0 16px 28px rgba(15, 23, 42, 0.04);
}
.aimd-protocol-recorder__content :deep(.aimd-step-card-block--level-2) { margin-left: 24px; }
.aimd-protocol-recorder__content :deep(.aimd-step-card-block--level-3) { margin-left: 48px; }
.aimd-protocol-recorder__content :deep(.aimd-step-card-block--checked),
.aimd-protocol-recorder__content :deep(.aimd-step-card-block--passive) {
  border-color: rgba(15, 118, 110, 0.18);
  background: linear-gradient(180deg, rgba(250, 252, 252, 0.98) 0%, rgba(244, 248, 247, 0.96) 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-step-card-block__header) {
  padding: 12px 16px;
  border-bottom: 1px solid #eef2f6;
  background: linear-gradient(180deg, #fcfdff 0%, #f8fafc 100%);
}
.aimd-protocol-recorder__content :deep(.aimd-step-card-block--checked .aimd-step-card-block__header),
.aimd-protocol-recorder__content :deep(.aimd-step-card-block--passive .aimd-step-card-block__header) {
  background: linear-gradient(180deg, rgba(246, 251, 250, 0.92) 0%, rgba(240, 247, 245, 0.9) 100%);
  border-bottom-color: rgba(15, 118, 110, 0.1);
}
.aimd-protocol-recorder__content :deep(.aimd-step-card-block__body) {
  padding: 16px 20px 18px;
  color: #374151;
  font-size: 14px;
  line-height: 1.7;
}
.aimd-protocol-recorder__content :deep(.aimd-step-card-block__body > :first-child) {
  margin-top: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-step-card-block__body > :last-child) {
  margin-bottom: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--quiz.aimd-field--quiz) { border-radius: 12px; border-color: #f6ddb0; background: #fffdf6; padding: 10px 12px; }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__check-wrap) {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__step-num) { font-weight: 600; color: #9a5800; }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--step > .aimd-step-field__main .aimd-rec-inline__check-wrap > .aimd-field__name) {
  font-size: 1.02rem;
  font-weight: 700;
  line-height: 1.3;
  color: #7b4300;
  overflow-wrap: anywhere;
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__pill) {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(154, 88, 0, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  color: #8a5a12;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__pill--estimate) {
  background: rgba(255, 244, 222, 0.95);
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__pill--actual) {
  color: #6b7280;
  border-color: rgba(107, 114, 128, 0.16);
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__pill--running) {
  color: #14532d;
  border-color: rgba(22, 101, 52, 0.2);
  background: rgba(236, 253, 245, 0.96);
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__hero) {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid rgba(154, 88, 0, 0.18);
  border-radius: 999px;
  background: rgba(255, 247, 237, 0.96);
  color: #9a5800;
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__hero--countdown) {
  border-color: rgba(154, 88, 0, 0.18);
  background: rgba(255, 247, 237, 0.96);
  color: #9a5800;
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__hero--warning) {
  border-color: rgba(180, 83, 9, 0.26);
  background: rgba(255, 251, 235, 0.98);
  color: #b45309;
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__hero--overtime) {
  border-color: rgba(185, 28, 28, 0.24);
  background: rgba(254, 242, 242, 0.98);
  color: #b91c1c;
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__controls) {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__btn) {
  border: 1px solid #d1d9e6;
  border-radius: 999px;
  min-height: 28px;
  padding: 0 10px;
  background: #fff;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s, color 0.2s;
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__btn:hover:not(:disabled)) {
  border-color: #9db1cc;
  background: #f7faff;
  color: #1f4f8f;
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__btn:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}
.aimd-protocol-recorder__content :deep(.aimd-step-timer__btn--ghost) {
  background: transparent;
}
.aimd-protocol-recorder__content :deep(.aimd-step-field__toggle) {
  color: #8a5a12;
  border-color: rgba(154, 88, 0, 0.18);
  background: rgba(255, 255, 255, 0.82);
}
.aimd-protocol-recorder__content :deep(.aimd-step-field__toggle:hover:not(:disabled)) {
  border-color: rgba(154, 88, 0, 0.34);
  background: rgba(255, 248, 235, 0.98);
  color: #7b4300;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline input[type="checkbox"]),
.aimd-protocol-recorder__content :deep(.aimd-checkbox) { width: 16px; height: 16px; accent-color: var(--rec-focus); }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__input) {
  height: 30px;
  min-width: 94px;
  padding: 0 10px;
  border: 1px solid #c8d3e1;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  background: #fff;
  color: var(--rec-text);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__input::placeholder) { color: #98a2b3; }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__input:focus) { border-color: var(--rec-focus); box-shadow: 0 0 0 2px rgba(47, 111, 237, 0.12); }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var .aimd-rec-inline__input) { width: clamp(120px, 28vw, 280px); }
.aimd-protocol-recorder__content :deep(.aimd-step-field__annotation-editor) {
  width: 100%;
  min-width: 0;
}

@media (max-width: 640px) {
  .aimd-protocol-recorder__content :deep(.aimd-step-field__details) {
    padding-top: 10px;
  }
  .aimd-protocol-recorder__content :deep(.aimd-step-field__main) {
    flex-direction: column;
  }
  .aimd-protocol-recorder__content :deep(.aimd-step-field__main-actions) {
    justify-content: flex-start;
  }
}
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__input.aimd-rec-inline__input--stacked),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline__textarea.aimd-rec-inline__textarea--stacked) { font-family: inherit; outline: none; }
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__table td) {
  vertical-align: middle;
  background: transparent;
  transition:
    background-color 0.2s ease,
    box-shadow 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.2s ease;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__table td:focus-within) {
  background: rgba(248, 250, 252, 0.96);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__table th) {
  vertical-align: middle;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-head),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-cell) {
  width: 38px;
  text-align: center;
  vertical-align: middle;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__action-head),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__action-cell) {
  width: 48px;
  text-align: center;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__table--dragging) {
  cursor: grabbing;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__row--dragging-source td) {
  opacity: 0.5;
  transform: scale(0.985);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__row--drag-over td) {
  background: linear-gradient(180deg, #f5f9ff 0%, #edf4ff 100%);
  box-shadow:
    inset 0 0 0 1px rgba(47, 111, 237, 0.18),
    0 10px 24px rgba(47, 111, 237, 0.08);
  transform: translateY(-2px);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__row--settling td) {
  animation: aimd-rec-inline-table-row-settle 0.48s cubic-bezier(0.22, 1, 0.36, 1);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__actions) {
  margin-top: 10px;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__add-btn),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__icon-btn) {
  border: 1px solid #c8d3e1;
  border-radius: 999px;
  padding: 4px 10px;
  background: #fff;
  color: #334155;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s, color 0.2s;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__add-btn:hover),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__icon-btn:hover:not(:disabled)) {
  border-color: #9db1cc;
  background: #f7faff;
  color: #1f4f8f;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__icon-btn:disabled),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__add-btn:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-handle) {
  display: inline-grid;
  grid-template-columns: repeat(2, 3px);
  grid-auto-rows: 3px;
  gap: 3px 3px;
  padding: 4px 7px 3px;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  border-radius: 999px;
  color: #b6c2d1;
  cursor: grab;
  user-select: none;
  transition: background-color 0.2s, color 0.2s, opacity 0.2s, transform 0.2s ease;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-dot) {
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.82;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-handle:hover) {
  background: rgba(47, 111, 237, 0.08);
  color: #6f86a4;
  transform: translateY(-1px);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-handle:hover .aimd-rec-inline-table__drag-dot) {
  opacity: 1;
  transform: scale(1.08);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-handle--disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-handle--disabled:hover) {
  background: transparent;
  color: #b6c2d1;
  transform: none;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-handle--dragging),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-handle:active) {
  cursor: grabbing;
  color: #5d7699;
  transform: scale(0.96);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-handle--dragging .aimd-rec-inline-table__drag-dot),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__drag-handle:active .aimd-rec-inline-table__drag-dot) {
  transform: scale(0.92);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-table-cell-input) {
  width: 100%;
  min-height: 40px;
  padding: 10px 12px;
  border: 0 none;
  border-radius: 0;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  color: var(--rec-text);
  background: transparent;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-table-cell-input:focus) {
  background: rgba(255, 255, 255, 0.98);
  box-shadow: inset 0 0 0 1px rgba(100, 116, 139, 0.35);
}

@media (max-width: 768px) {
  .aimd-protocol-recorder__content {
    padding: 18px 16px;
    border-radius: 14px;
  }

  .aimd-protocol-recorder__content :deep(h1) {
    font-size: 1.6rem;
  }

  .aimd-protocol-recorder__content :deep(h2) {
    margin-top: 1.35em;
    font-size: 1.22rem;
  }

  .aimd-protocol-recorder__content :deep(.aimd-callout) {
    padding: 14px 14px 16px 18px;
    border-radius: 14px;
  }

  .aimd-protocol-recorder__content :deep(.aimd-step-card-block--level-2) {
    margin-left: 14px;
  }

  .aimd-protocol-recorder__content :deep(.aimd-step-card-block--level-3) {
    margin-left: 22px;
  }
}

@keyframes aimd-rec-inline-table-row-settle {
  0% {
    background-color: #deebff;
    box-shadow:
      inset 0 0 0 1px rgba(47, 111, 237, 0.22),
      0 14px 28px rgba(47, 111, 237, 0.14);
    transform: translateY(8px) scale(0.985);
  }

  60% {
    background-color: #edf4ff;
    box-shadow:
      inset 0 0 0 1px rgba(47, 111, 237, 0.12),
      0 8px 18px rgba(47, 111, 237, 0.08);
    transform: translateY(-1px) scale(1);
  }

  100% {
    background-color: transparent;
    box-shadow: none;
    transform: none;
  }
}
</style>
