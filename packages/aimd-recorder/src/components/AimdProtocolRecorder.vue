<script setup lang="ts">
import { h, reactive, ref, watch, type VNode } from "vue"
import type {
  AimdCheckNode,
  AimdQuizField,
  AimdQuizNode,
  AimdStepNode,
  AimdVarNode,
  AimdVarTableField,
  AimdVarTableNode,
  ExtractedAimdFields,
} from "@airalogy/aimd-core/types"
import { parseAndExtract, renderToVue } from "@airalogy/aimd-renderer"
import type { AimdProtocolRecordData } from "../types"
import { createEmptyProtocolRecordData } from "../types"
import AimdQuizRecorder from "./AimdQuizRecorder.vue"

const props = withDefaults(defineProps<{
  content: string
  modelValue?: Partial<AimdProtocolRecordData>
  readonly?: boolean
}>(), {
  modelValue: undefined,
  readonly: false,
})

const emit = defineEmits<{
  (e: "update:modelValue", value: AimdProtocolRecordData): void
  (e: "fields-change", fields: ExtractedAimdFields): void
  (e: "error", message: string): void
}>()

const inlineNodes = ref<VNode[]>([])
const renderError = ref("")
const localRecord = reactive<AimdProtocolRecordData>(createEmptyProtocolRecordData())
let buildRequestId = 0
let syncingFromExternal = false
let renderScheduled = false

const EMPTY_FIELDS: ExtractedAimdFields = {
  var: [],
  var_table: [],
  quiz: [],
  step: [],
  check: [],
  ref_step: [],
  ref_var: [],
  ref_fig: [],
  cite: [],
  fig: [],
}

function cloneRecordData(value: AimdProtocolRecordData): AimdProtocolRecordData {
  return JSON.parse(JSON.stringify(value))
}

function normalizeStepLike(value: unknown): { checked: boolean, annotation: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { checked: false, annotation: "" }
  }

  const obj = value as Record<string, unknown>
  return {
    checked: Boolean(obj.checked),
    annotation: typeof obj.annotation === "string" ? obj.annotation : "",
  }
}

function normalizeIncomingRecord(value: Partial<AimdProtocolRecordData> | undefined): AimdProtocolRecordData {
  const normalized = createEmptyProtocolRecordData()
  if (!value || typeof value !== "object") {
    return normalized
  }

  if (value.var && typeof value.var === "object") {
    normalized.var = { ...value.var }
  }
  if (value.quiz && typeof value.quiz === "object") {
    normalized.quiz = { ...value.quiz }
  }
  if (value.step && typeof value.step === "object") {
    for (const [key, item] of Object.entries(value.step)) {
      normalized.step[key] = normalizeStepLike(item)
    }
  }
  if (value.check && typeof value.check === "object") {
    for (const [key, item] of Object.entries(value.check)) {
      normalized.check[key] = normalizeStepLike(item)
    }
  }

  return normalized
}

function replaceSection(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const key of Object.keys(target)) {
    delete target[key]
  }
  Object.assign(target, source)
}

function applyIncomingRecord(value: Partial<AimdProtocolRecordData> | undefined) {
  const normalized = normalizeIncomingRecord(value)
  replaceSection(localRecord.var as Record<string, unknown>, normalized.var)
  replaceSection(localRecord.step as Record<string, unknown>, normalized.step as Record<string, unknown>)
  replaceSection(localRecord.check as Record<string, unknown>, normalized.check as Record<string, unknown>)
  replaceSection(localRecord.quiz as Record<string, unknown>, normalized.quiz)
}

function emitRecordUpdate() {
  if (syncingFromExternal) {
    return
  }
  emit("update:modelValue", cloneRecordData(localRecord))
}

function scheduleInlineRebuild() {
  if (renderScheduled) {
    return
  }
  renderScheduled = true
  Promise.resolve().then(() => {
    renderScheduled = false
    void rebuildInlineNodes()
  })
}

function markRecordChanged(options?: { rebuild?: boolean }) {
  emitRecordUpdate()
  if (options?.rebuild) {
    scheduleInlineRebuild()
  }
}

function normalizeVarFields(raw: unknown): Array<{ name: string, definition?: { type?: string, default?: unknown } }> {
  if (!Array.isArray(raw)) {
    return []
  }

  const normalized: Array<{ name: string, definition?: { type?: string, default?: unknown } }> = []
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      normalized.push({ name: item.trim() })
      continue
    }
    if (item && typeof item === "object" && typeof (item as any).name === "string") {
      normalized.push(item as { name: string, definition?: { type?: string, default?: unknown } })
    }
  }
  return normalized
}

function normalizeStepFields(raw: unknown): Array<{ name: string }> {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((item) => {
      if (typeof item === "string" && item.trim()) {
        return { name: item.trim() }
      }
      if (item && typeof item === "object" && typeof (item as any).name === "string") {
        return { name: (item as any).name as string }
      }
      return null
    })
    .filter((item): item is { name: string } => item !== null)
}

function normalizeCheckFields(raw: unknown): Array<{ name: string, label?: string }> {
  if (!Array.isArray(raw)) {
    return []
  }

  const normalized: Array<{ name: string, label?: string }> = []
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      const label = item.trim()
      normalized.push({ name: label, label })
      continue
    }

    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>
      if (typeof obj.name === "string") {
        normalized.push({
          name: obj.name,
          label: typeof obj.label === "string" ? obj.label : undefined,
        })
      }
    }
  }

  return normalized
}

function normalizeQuizFields(raw: unknown): AimdQuizField[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.filter((item): item is AimdQuizField => (
    !!item
    && typeof item === "object"
    && typeof (item as any).id === "string"
    && typeof (item as any).type === "string"
    && typeof (item as any).stem === "string"
  ))
}

function normalizeVarTableFields(raw: unknown): AimdVarTableField[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.filter((item): item is AimdVarTableField => (
    !!item
    && typeof item === "object"
    && typeof (item as any).name === "string"
    && Array.isArray((item as any).subvars)
  ))
}

function getQuizDefaultValue(quiz: AimdQuizField): unknown {
  if (quiz.type === "choice") {
    const optionKeys = new Set((quiz.options || []).map(option => option.key))
    if (quiz.mode === "multiple") {
      if (Array.isArray(quiz.default)) {
        return quiz.default.filter((item): item is string => typeof item === "string" && optionKeys.has(item))
      }
      return []
    }

    if (typeof quiz.default === "string" && optionKeys.has(quiz.default)) {
      return quiz.default
    }
    return ""
  }

  if (quiz.type === "blank") {
    const blankKeys = (quiz.blanks || []).map(blank => blank.key)
    if (quiz.default && typeof quiz.default === "object" && !Array.isArray(quiz.default)) {
      const objDefault = quiz.default as Record<string, unknown>
      const normalized: Record<string, string> = {}
      for (const key of blankKeys) {
        const value = objDefault[key]
        normalized[key] = typeof value === "string" ? value : ""
      }
      return normalized
    }

    if (typeof quiz.default === "string" && blankKeys.length === 1) {
      return { [blankKeys[0]]: quiz.default }
    }

    const blankValueMap: Record<string, string> = {}
    for (const key of blankKeys) {
      blankValueMap[key] = ""
    }
    return blankValueMap
  }

  if (typeof quiz.default === "string") {
    return quiz.default
  }
  return ""
}

function getVarInputType(type: string): string {
  if (type === "float" || type === "int" || type === "integer" || type === "number") {
    return "number"
  }
  if (type === "bool") {
    return "checkbox"
  }
  return "text"
}

function getVarTableColumns(node: AimdVarTableNode): string[] {
  if (Array.isArray(node.columns) && node.columns.length > 0) {
    return node.columns
  }
  const subvars = node.definition?.subvars
  if (subvars && typeof subvars === "object") {
    return Object.keys(subvars)
  }
  return []
}

function createEmptyVarTableRow(columns: string[]): Record<string, string> {
  const row: Record<string, string> = {}
  for (const column of columns) {
    row[column] = ""
  }
  return row
}

function normalizeVarTableRows(raw: unknown, columns: string[]): Record<string, string>[] {
  if (!Array.isArray(raw)) {
    return [createEmptyVarTableRow(columns)]
  }

  const rows = raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return createEmptyVarTableRow(columns)
    }
    const source = item as Record<string, unknown>
    const row: Record<string, string> = {}
    for (const column of columns) {
      const value = source[column]
      row[column] = typeof value === "string" ? value : `${value ?? ""}`
    }
    return row
  })

  if (rows.length === 0) {
    rows.push(createEmptyVarTableRow(columns))
  }

  return rows
}

function ensureVarTableRows(tableName: string, columns: string[]): Record<string, string>[] {
  const normalized = normalizeVarTableRows(localRecord.var[tableName], columns)
  localRecord.var[tableName] = normalized
  return normalized
}

function addVarTableRow(tableName: string, columns: string[]) {
  const rows = ensureVarTableRows(tableName, columns)
  rows.push(createEmptyVarTableRow(columns))
  markRecordChanged({ rebuild: true })
}

function removeVarTableRow(tableName: string, rowIndex: number, columns: string[]) {
  const rows = ensureVarTableRows(tableName, columns)
  if (rows.length <= 1) {
    return
  }
  rows.splice(rowIndex, 1)
  markRecordChanged({ rebuild: true })
}

function ensureDefaultsFromFields(fields: ExtractedAimdFields): boolean {
  let changed = false

  for (const v of normalizeVarFields(fields.var)) {
    if (!(v.name in localRecord.var)) {
      localRecord.var[v.name] = v.definition?.default ?? ""
      changed = true
    }
  }

  for (const vt of normalizeVarTableFields(fields.var_table)) {
    const columns = vt.subvars.map(subvar => subvar.name)
    const rows = localRecord.var[vt.name]
    const normalizedRows = normalizeVarTableRows(rows, columns)
    if (JSON.stringify(normalizedRows) !== JSON.stringify(rows)) {
      localRecord.var[vt.name] = normalizedRows
      changed = true
    }
  }

  for (const step of normalizeStepFields(fields.step)) {
    if (!(step.name in localRecord.step)) {
      localRecord.step[step.name] = { checked: false, annotation: "" }
      changed = true
    }
  }

  for (const check of normalizeCheckFields(fields.check)) {
    if (!(check.name in localRecord.check)) {
      localRecord.check[check.name] = { checked: false, annotation: "" }
      changed = true
    }
  }

  for (const quiz of normalizeQuizFields(fields.quiz)) {
    if (!(quiz.id in localRecord.quiz)) {
      localRecord.quiz[quiz.id] = getQuizDefaultValue(quiz)
      changed = true
    }
  }

  return changed
}

function renderInlineVar(node: AimdVarNode): VNode {
  const name = node.name
  const type = node.definition?.type || "str"
  if (!(name in localRecord.var)) {
    localRecord.var[name] = node.definition?.default ?? ""
  }

  if (getVarInputType(type) === "checkbox") {
    return h("label", { class: "aimd-rec-inline aimd-rec-inline--var aimd-field aimd-field--var aimd-rec-inline--checkbox" }, [
      h("span", { class: "aimd-field__scope" }, "var"),
      h("span", { class: "aimd-field__name" }, name),
      h("input", {
        type: "checkbox",
        disabled: props.readonly,
        checked: Boolean(localRecord.var[name]),
        onChange: (event: Event) => {
          localRecord.var[name] = (event.target as HTMLInputElement).checked
          markRecordChanged()
        },
      }),
    ])
  }

  return h("span", { class: "aimd-rec-inline aimd-rec-inline--var aimd-field aimd-field--var" }, [
    h("span", { class: "aimd-field__scope" }, "var"),
    h("span", { class: "aimd-field__name" }, name),
    h("input", {
      class: "aimd-rec-inline__input",
      type: getVarInputType(type),
      disabled: props.readonly,
      step: type === "float" ? "0.01" : undefined,
      value: localRecord.var[name] ?? "",
      onInput: (event: Event) => {
        localRecord.var[name] = (event.target as HTMLInputElement).value
        markRecordChanged()
      },
    }),
  ])
}

function renderInlineVarTable(node: AimdVarTableNode): VNode {
  const tableName = node.name
  const columns = getVarTableColumns(node)
  const rows = ensureVarTableRows(tableName, columns)

  return h("div", { class: "aimd-field aimd-field--var-table aimd-rec-inline-table" }, [
    h("div", { class: "aimd-field__header" }, [
      h("span", { class: "aimd-field__scope" }, "table"),
      h("span", { class: "aimd-field__name" }, tableName),
    ]),
    h("table", { class: "aimd-field__table-preview aimd-rec-inline-table__table" }, [
      h("thead", [
        h("tr", [
          ...columns.map(column => h("th", column)),
          h("th", { class: "aimd-rec-inline-table__action-head" }, "操作"),
        ]),
      ]),
      h("tbody", rows.map((row, rowIndex) => h("tr", { key: `${tableName}-row-${rowIndex}` }, [
        ...columns.map(column => h("td", { key: `${tableName}-${rowIndex}-${column}` }, [
          h("input", {
            class: "aimd-rec-table-cell-input",
            disabled: props.readonly,
            placeholder: column,
            value: row[column] ?? "",
            onInput: (event: Event) => {
              row[column] = (event.target as HTMLInputElement).value
              markRecordChanged()
            },
          }),
        ])),
        h("td", { class: "aimd-rec-inline-table__action-cell" }, [
          h("button", {
            type: "button",
            class: "aimd-rec-inline-table__row-btn",
            disabled: props.readonly || rows.length <= 1,
            onClick: () => removeVarTableRow(tableName, rowIndex, columns),
          }, "删除"),
        ]),
      ]))),
    ]),
    h("div", { class: "aimd-rec-inline-table__actions" }, [
      h("button", {
        type: "button",
        class: "aimd-rec-inline-table__add-btn",
        disabled: props.readonly,
        onClick: () => addVarTableRow(tableName, columns),
      }, "+ 添加行"),
    ]),
  ])
}

function renderInlineStep(node: AimdStepNode): VNode {
  const name = node.name
  if (!(name in localRecord.step)) {
    localRecord.step[name] = { checked: false, annotation: "" }
  }

  const state = localRecord.step[name]
  const stepNumber = node.step || "?"

  return h("span", { class: "aimd-rec-inline aimd-rec-inline--step aimd-field aimd-field--step" }, [
    h("label", { class: "aimd-rec-inline__check-wrap" }, [
      h("input", {
        type: "checkbox",
        disabled: props.readonly,
        checked: Boolean(state.checked),
        onChange: (event: Event) => {
          state.checked = (event.target as HTMLInputElement).checked
          markRecordChanged()
        },
      }),
      h("span", { class: "aimd-field__scope" }, "step"),
      h("span", { class: "aimd-rec-inline__step-num" }, stepNumber),
      h("span", { class: "aimd-field__name" }, name),
    ]),
    h("input", {
      class: "aimd-rec-inline__input aimd-rec-inline__input--annotation",
      disabled: props.readonly,
      placeholder: "备注",
      value: state.annotation || "",
      onInput: (event: Event) => {
        state.annotation = (event.target as HTMLInputElement).value
        markRecordChanged()
      },
    }),
  ])
}

function renderInlineCheck(node: AimdCheckNode): VNode {
  const name = node.name
  if (!(name in localRecord.check)) {
    localRecord.check[name] = { checked: false, annotation: "" }
  }

  const state = localRecord.check[name]

  return h("span", { class: "aimd-rec-inline aimd-rec-inline--check aimd-field aimd-field--check" }, [
    h("label", { class: "aimd-rec-inline__check-wrap" }, [
      h("input", {
        type: "checkbox",
        class: "aimd-checkbox",
        disabled: props.readonly,
        checked: Boolean(state.checked),
        onChange: (event: Event) => {
          state.checked = (event.target as HTMLInputElement).checked
          markRecordChanged()
        },
      }),
      h("span", { class: "aimd-field__scope" }, "check"),
      h("span", { class: "aimd-field__name" }, node.label || name),
    ]),
    h("input", {
      class: "aimd-rec-inline__input aimd-rec-inline__input--annotation",
      disabled: props.readonly,
      placeholder: "检查备注",
      value: state.annotation || "",
      onInput: (event: Event) => {
        state.annotation = (event.target as HTMLInputElement).value
        markRecordChanged()
      },
    }),
  ])
}

function renderInlineQuiz(node: AimdQuizNode): VNode {
  const quizId = node.name
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

  return h(AimdQuizRecorder, {
    class: "aimd-rec-inline aimd-rec-inline--quiz",
    quiz: quizField,
    modelValue: localRecord.quiz[quizId],
    readonly: props.readonly,
    "onUpdate:modelValue": (value: unknown) => {
      localRecord.quiz[quizId] = value
      markRecordChanged()
    },
  })
}

async function rebuildInlineNodes(expectedRequestId?: number) {
  const rendered = await renderToVue(props.content || "", {
    mode: "edit",
    aimdRenderers: {
      var: node => renderInlineVar(node as AimdVarNode),
      var_table: node => renderInlineVarTable(node as AimdVarTableNode),
      step: node => renderInlineStep(node as AimdStepNode),
      check: node => renderInlineCheck(node as AimdCheckNode),
      quiz: node => renderInlineQuiz(node as AimdQuizNode),
    },
  })

  if (expectedRequestId !== undefined && expectedRequestId !== buildRequestId) {
    return
  }

  inlineNodes.value = rendered.nodes
}

async function parseAndBuild() {
  const currentRequestId = ++buildRequestId

  try {
    renderError.value = ""
    const extracted = parseAndExtract(props.content || "")
    if (currentRequestId !== buildRequestId) {
      return
    }

    emit("fields-change", extracted)

    const changed = ensureDefaultsFromFields(extracted)
    if (changed) {
      emitRecordUpdate()
    }

    await rebuildInlineNodes(currentRequestId)
  } catch (error) {
    if (currentRequestId !== buildRequestId) {
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    renderError.value = message
    inlineNodes.value = []
    emit("fields-change", EMPTY_FIELDS)
    emit("error", message)
  }
}

watch(
  () => props.modelValue,
  (value) => {
    syncingFromExternal = true
    applyIncomingRecord(value)
    syncingFromExternal = false
    scheduleInlineRebuild()
  },
  { deep: true, immediate: true },
)

watch(
  () => props.content,
  () => {
    void parseAndBuild()
  },
  { immediate: true },
)
</script>

<template>
  <div class="aimd-protocol-recorder">
    <div v-if="renderError" class="aimd-protocol-recorder__error">{{ renderError }}</div>

    <div v-else-if="inlineNodes.length" class="aimd-protocol-recorder__content">
      <component :is="() => inlineNodes" />
    </div>

    <div v-else class="aimd-protocol-recorder__empty">No renderable protocol content.</div>
  </div>
</template>

<style scoped>
.aimd-protocol-recorder {
  --rec-text: #253041;
  --rec-muted: #667085;
  --rec-border: #e3e8ef;
  --rec-focus: #2f6fed;
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

.aimd-protocol-recorder__content {
  padding: 18px 20px;
  border: 1px solid var(--rec-border);
  border-radius: 14px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  color: var(--rec-text);
  line-height: 1.7;
}

.aimd-protocol-recorder__empty {
  padding: 24px;
  border: 1px dashed #d7dbe3;
  border-radius: 8px;
  color: #7b8595;
  text-align: center;
}

.aimd-protocol-recorder__content :deep(h1) {
  margin: 0.45em 0 0.5em;
  font-size: 1.7em;
  line-height: 1.25;
}

.aimd-protocol-recorder__content :deep(h2) {
  margin: 0.8em 0 0.45em;
  font-size: 1.35em;
  line-height: 1.3;
}

.aimd-protocol-recorder__content :deep(h3) {
  margin: 0.7em 0 0.4em;
  font-size: 1.15em;
}

.aimd-protocol-recorder__content :deep(p) {
  margin: 0.45em 0;
  color: var(--rec-text);
}

.aimd-protocol-recorder__content :deep(ul),
.aimd-protocol-recorder__content :deep(ol) {
  margin: 0.35em 0;
  padding-left: 22px;
}

.aimd-protocol-recorder__content :deep(table) {
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 14px;
}

.aimd-protocol-recorder__content :deep(th),
.aimd-protocol-recorder__content :deep(td) {
  border: 1px solid #e2e8f0;
  padding: 6px 10px;
  text-align: left;
}

.aimd-protocol-recorder__content :deep(th) {
  background: #f8fafc;
}

.aimd-protocol-recorder__content :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 12px;
  border-left: 3px solid #d8dee8;
  color: #666;
  background: #fafbfc;
}

.aimd-protocol-recorder__content :deep(code) {
  background: #f0f2f5;
  border-radius: 4px;
  padding: 2px 5px;
}

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

.aimd-protocol-recorder__content :deep(.aimd-field--var) {
  background: #f3f8ff;
  border-color: #c9dcff;
  color: #1c4e90;
}

.aimd-protocol-recorder__content :deep(.aimd-field--var .aimd-field__scope) {
  background: #dceaff;
  color: #255eab;
}

.aimd-protocol-recorder__content :deep(.aimd-field--step) {
  background: #fff9ef;
  border-color: #f4d9a8;
  color: #9a5800;
}

.aimd-protocol-recorder__content :deep(.aimd-field--step .aimd-field__scope) {
  background: #ffe8bf;
  color: #9a5800;
}

.aimd-protocol-recorder__content :deep(.aimd-field--check) {
  background: #f8fafc;
  border-color: #d8dfe8;
  color: #2b3443;
  padding: 3px 8px;
}

.aimd-protocol-recorder__content :deep(.aimd-field--check .aimd-field__scope) {
  background: #e7ecf3;
  color: #4f5f77;
}

.aimd-protocol-recorder__content :deep(.aimd-field--var-table) {
  background: #f3fbf3;
  border: 1px solid #cfe7cf;
  color: #276738;
  border-radius: 12px;
  padding: 10px 12px;
}

.aimd-protocol-recorder__content :deep(.aimd-field--var-table .aimd-field__scope) {
  background: #daf1dc;
  color: #2f7b40;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 5px 3px;
  vertical-align: middle;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline--step),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline--check) {
  gap: 8px;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline--quiz) {
  display: block;
  margin: 12px 0;
  padding: 0;
  border: none;
  background: transparent;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline--quiz.aimd-field--quiz) {
  border-radius: 12px;
  border-color: #f6ddb0;
  background: #fffdf6;
  padding: 10px 12px;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline__check-wrap) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline__step-num) {
  font-weight: 600;
  color: #9a5800;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline input[type="checkbox"]),
.aimd-protocol-recorder__content :deep(.aimd-checkbox) {
  width: 16px;
  height: 16px;
  accent-color: var(--rec-focus);
}

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

.aimd-protocol-recorder__content :deep(.aimd-rec-inline__input::placeholder) {
  color: #98a2b3;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline__input:focus) {
  border-color: var(--rec-focus);
  box-shadow: 0 0 0 2px rgba(47, 111, 237, 0.12);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline--var .aimd-rec-inline__input) {
  width: clamp(120px, 28vw, 280px);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline__input--annotation) {
  width: clamp(130px, 24vw, 220px);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table) {
  display: block;
  width: 100%;
  max-width: none;
  margin: 12px 0 14px;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__table) {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  overflow: hidden;
  border-radius: 8px;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__action-head),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__action-cell) {
  width: 84px;
  text-align: center;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__actions) {
  margin-top: 10px;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__add-btn),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__row-btn) {
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
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__row-btn:hover:not(:disabled)) {
  border-color: #9db1cc;
  background: #f7faff;
  color: #1f4f8f;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__row-btn:disabled),
.aimd-protocol-recorder__content :deep(.aimd-rec-inline-table__add-btn:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.aimd-protocol-recorder__content :deep(.aimd-rec-table-cell-input) {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #d2dbe7;
  border-radius: 7px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  color: var(--rec-text);
}

.aimd-protocol-recorder__content :deep(.aimd-rec-table-cell-input:focus) {
  border-color: var(--rec-focus);
  box-shadow: 0 0 0 2px rgba(47, 111, 237, 0.1);
}
</style>
