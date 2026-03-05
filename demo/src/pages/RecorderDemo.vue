<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import type { AimdQuizField, AimdVarTableField } from '@airalogy/aimd-core/types'
import { parseAndExtract } from '@airalogy/aimd-renderer'
import { AimdQuizRecorder } from '@airalogy/aimd-recorder/components'
import '@airalogy/aimd-recorder/styles'
import { SAMPLE_AIMD } from '../composables/sampleContent'

interface VarFieldLike {
  name: string
  definition?: {
    type?: string
    default?: unknown
  }
}

interface StepFieldLike {
  name: string
  step?: number
}

interface CheckFieldLike {
  name: string
  label?: string
}

const input = ref(SAMPLE_AIMD)

// Extracted fields from AIMD
const fields = ref<any>({})

// Reactive record model: { scope: { fieldName: value } }
const recordData = reactive<Record<string, Record<string, any>>>({
  research_variable: {},
  research_step: {},
  research_check: {},
  quiz: {},
})

function normalizeVarFields(raw: unknown): VarFieldLike[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const normalized: VarFieldLike[] = []
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      normalized.push({ name: item.trim() })
      continue
    }
    if (item && typeof item === 'object' && typeof (item as any).name === 'string') {
      normalized.push(item as VarFieldLike)
    }
  }
  return normalized
}

function normalizeStepFields(raw: unknown): StepFieldLike[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const normalized: StepFieldLike[] = []
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      normalized.push({ name: item.trim() })
      continue
    }
    if (item && typeof item === 'object' && typeof (item as any).name === 'string') {
      normalized.push(item as StepFieldLike)
    }
  }
  return normalized
}

function normalizeCheckFields(raw: unknown): CheckFieldLike[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const normalized: CheckFieldLike[] = []
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      normalized.push({ name: item.trim(), label: item.trim() })
      continue
    }
    if (item && typeof item === 'object' && typeof (item as any).name === 'string') {
      normalized.push(item as CheckFieldLike)
    }
  }
  return normalized
}

function normalizeVarTableFields(raw: unknown): AimdVarTableField[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.filter((item): item is AimdVarTableField => (
    !!item
    && typeof item === 'object'
    && typeof (item as any).name === 'string'
  ))
}

function normalizeQuizFields(raw: unknown): AimdQuizField[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.filter((item): item is AimdQuizField => (
    !!item
    && typeof item === 'object'
    && typeof (item as any).id === 'string'
    && typeof (item as any).type === 'string'
    && typeof (item as any).stem === 'string'
  ))
}

const varFields = computed<VarFieldLike[]>(() => normalizeVarFields(fields.value.var))
const stepFields = computed<StepFieldLike[]>(() => normalizeStepFields(fields.value.step))
const checkFields = computed<CheckFieldLike[]>(() => normalizeCheckFields(fields.value.check))
const varTableFields = computed<AimdVarTableField[]>(() => normalizeVarTableFields(fields.value.var_table))
const quizFields = computed<AimdQuizField[]>(() => normalizeQuizFields(fields.value.quiz))

function getVarDefaultValue(v: VarFieldLike): unknown {
  return v.definition?.default ?? ''
}

function getQuizDefaultValue(quiz: AimdQuizField): unknown {
  if (quiz.type === 'choice') {
    const optionKeys = new Set((quiz.options || []).map(option => option.key))
    if (quiz.mode === 'multiple') {
      if (Array.isArray(quiz.default)) {
        return quiz.default.filter((item): item is string => typeof item === 'string' && optionKeys.has(item))
      }
      return []
    }

    if (typeof quiz.default === 'string' && optionKeys.has(quiz.default)) {
      return quiz.default
    }
    return ''
  }

  if (quiz.type === 'blank') {
    const blankKeys = (quiz.blanks || []).map(blank => blank.key)
    if (quiz.default && typeof quiz.default === 'object' && !Array.isArray(quiz.default)) {
      const objDefault = quiz.default as Record<string, unknown>
      const normalized: Record<string, string> = {}
      for (const key of blankKeys) {
        const value = objDefault[key]
        normalized[key] = typeof value === 'string' ? value : ''
      }
      return normalized
    }

    if (typeof quiz.default === 'string' && blankKeys.length === 1) {
      return { [blankKeys[0]]: quiz.default }
    }

    const blankValueMap: Record<string, string> = {}
    for (const key of blankKeys) {
      blankValueMap[key] = ''
    }
    return blankValueMap
  }

  if (typeof quiz.default === 'string') {
    return quiz.default
  }
  return ''
}

function getVarTableColumns(table: AimdVarTableField): string[] {
  const legacyColumns = (table as any).columns
  if (Array.isArray(legacyColumns)) {
    return legacyColumns.filter((item): item is string => typeof item === 'string')
  }

  if (Array.isArray(table.subvars)) {
    return table.subvars.map(subvar =>
      typeof subvar === 'string' ? subvar : subvar.name,
    )
  }

  return []
}

// Parse and extract fields
function extractFields() {
  const result = parseAndExtract(input.value)
  fields.value = result

  for (const v of normalizeVarFields(result.var)) {
    if (!(v.name in recordData.research_variable)) {
      recordData.research_variable[v.name] = getVarDefaultValue(v)
    }
  }

  for (const s of normalizeStepFields(result.step)) {
    if (!(s.name in recordData.research_step)) {
      recordData.research_step[s.name] = { checked: false, annotation: '' }
    }
  }

  for (const c of normalizeCheckFields(result.check)) {
    if (!(c.name in recordData.research_check)) {
      recordData.research_check[c.name] = { checked: false, annotation: '' }
    }
  }

  for (const q of normalizeQuizFields(result.quiz)) {
    if (!(q.id in recordData.quiz)) {
      recordData.quiz[q.id] = getQuizDefaultValue(q)
    }
  }
}

watch(input, extractFields, { immediate: true })

// Collected data as JSON
const collectedJson = computed(() => {
  return JSON.stringify(recordData, null, 2)
})

function resetForm() {
  for (const v of varFields.value) {
    recordData.research_variable[v.name] = getVarDefaultValue(v)
  }
  Object.keys(recordData.research_step).forEach(k => {
    recordData.research_step[k] = { checked: false, annotation: '' }
  })
  Object.keys(recordData.research_check).forEach(k => {
    recordData.research_check[k] = { checked: false, annotation: '' }
  })
  for (const q of quizFields.value) {
    recordData.quiz[q.id] = getQuizDefaultValue(q)
  }
}

function getVarType(v: VarFieldLike): string {
  return v.definition?.type || 'str'
}

function getInputType(type: string): string {
  if (type === 'float' || type === 'int' || type === 'integer' || type === 'number') return 'number'
  if (type === 'bool') return 'checkbox'
  return 'text'
}
</script>

<template>
  <div class="demo-page">
    <h2 class="page-title">@airalogy/aimd-recorder</h2>
    <p class="page-desc">AIMD 数据记录器 — 解析 AIMD 字段并生成交互式表单，收集填写数据</p>

    <div class="demo-layout">
      <!-- Left: AIMD source -->
      <div class="panel">
        <h3 class="panel-title">AIMD 源文本</h3>
        <textarea v-model="input" class="code-input" spellcheck="false" />
      </div>

      <!-- Right: Interactive form -->
      <div class="panel">
        <div class="panel-title-bar">
          <h3 class="panel-title-text">数据记录表单</h3>
          <button class="reset-btn" @click="resetForm">重置</button>
        </div>

        <div class="form-content">
          <!-- Variables -->
          <div v-if="varFields.length" class="form-section">
            <h4 class="section-title">
              <span class="aimd-field__scope">VAR</span>
              变量字段
            </h4>
            <div v-for="v in varFields" :key="v.name" class="form-field">
              <label class="field-label">
                <span class="aimd-field aimd-field--var" style="margin-right: 8px">
                  <span class="aimd-field__scope">VAR</span>
                  <span class="aimd-field__name">{{ v.name }}</span>
                  <span v-if="v.definition?.type" class="aimd-field__type">: {{ v.definition.type }}</span>
                </span>
              </label>
              <div class="field-input-wrapper">
                <input
                  v-if="getInputType(getVarType(v)) === 'checkbox'"
                  type="checkbox"
                  v-model="recordData.research_variable[v.name]"
                  class="field-checkbox"
                />
                <input
                  v-else
                  :type="getInputType(getVarType(v))"
                  v-model="recordData.research_variable[v.name]"
                  :placeholder="`输入 ${v.name}...`"
                  :step="getVarType(v) === 'float' ? '0.01' : undefined"
                  class="field-input"
                />
              </div>
            </div>
          </div>

          <!-- Variable Tables -->
          <div v-if="varTableFields.length" class="form-section">
            <h4 class="section-title">
              <span class="aimd-field__scope aimd-field__scope--var_table">TABLE</span>
              变量表
            </h4>
            <div v-for="vt in varTableFields" :key="vt.name" class="form-field">
              <div class="aimd-field--var-table">
                <div class="aimd-field__header">
                  <span class="aimd-field__scope">TABLE</span>
                  <span class="aimd-field__name">{{ vt.name }}</span>
                </div>
                <table v-if="getVarTableColumns(vt).length" class="aimd-field__table-preview">
                  <thead>
                    <tr>
                      <th v-for="col in getVarTableColumns(vt)" :key="col">{{ col }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td v-for="col in getVarTableColumns(vt)" :key="col">
                        <input class="table-cell-input" :placeholder="col" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Quiz -->
          <div v-if="quizFields.length" class="form-section">
            <h4 class="section-title">
              <span class="aimd-field__scope">QUIZ</span>
              题目作答
            </h4>
            <AimdQuizRecorder
              v-for="quiz in quizFields"
              :key="quiz.id"
              v-model="recordData.quiz[quiz.id]"
              :quiz="quiz"
              class="form-field"
            />
          </div>

          <!-- Steps -->
          <div v-if="stepFields.length" class="form-section">
            <h4 class="section-title">
              <span class="aimd-field__scope aimd-field__scope--step">STEP</span>
              实验步骤
            </h4>
            <div v-for="s in stepFields" :key="s.name" class="form-field step-field">
              <div class="step-header">
                <span class="research-step__sequence">Step {{ s.step || '?' }} &gt;</span>
                <span class="step-name">{{ s.name }}</span>
              </div>
              <div class="step-controls">
                <label class="step-check-label">
                  <input
                    type="checkbox"
                    v-model="recordData.research_step[s.name].checked"
                    class="aimd-checkbox"
                  />
                  完成
                </label>
                <input
                  v-model="recordData.research_step[s.name].annotation"
                  placeholder="备注..."
                  class="field-input annotation-input"
                />
              </div>
            </div>
          </div>

          <!-- Checks -->
          <div v-if="checkFields.length" class="form-section">
            <h4 class="section-title">
              <span class="aimd-field__scope aimd-field__scope--check">CHECK</span>
              质量检查
            </h4>
            <div v-for="c in checkFields" :key="c.name" class="form-field">
              <label class="aimd-field aimd-field--check" style="width: 100%; cursor: pointer">
                <input
                  type="checkbox"
                  v-model="recordData.research_check[c.name].checked"
                  class="aimd-checkbox"
                />
                <span class="aimd-field__label">{{ c.label || c.name }}</span>
              </label>
              <input
                v-model="recordData.research_check[c.name].annotation"
                placeholder="检查备注..."
                class="field-input annotation-input"
                style="margin-top: 4px"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Collected data -->
    <div class="panel full-width">
      <h3 class="panel-title">收集到的数据 (Record Data)</h3>
      <pre class="code-output">{{ collectedJson }}</pre>
    </div>
  </div>
</template>

<style scoped>
.demo-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 700;
  color: #1a1a2e;
}

.page-desc {
  color: #666;
  font-size: 14px;
  margin-top: -12px;
}

.demo-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.panel {
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  overflow: hidden;
}

.panel.full-width {
  width: 100%;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  padding: 12px 16px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
  color: #444;
}

.panel-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #fafafa;
  border-bottom: 1px solid #e8e8e8;
}

.panel-title-text {
  font-size: 14px;
  font-weight: 600;
  color: #444;
}

.reset-btn {
  padding: 4px 12px;
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  color: #666;
  transition: all 0.2s;
}

.reset-btn:hover {
  border-color: #d03050;
  color: #d03050;
}

.code-input {
  width: 100%;
  min-height: 500px;
  padding: 16px;
  border: none;
  outline: none;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  background: #fff;
  color: #333;
}

.form-content {
  padding: 16px;
  max-height: 500px;
  overflow: auto;
}

.form-section {
  margin-bottom: 20px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #444;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-field {
  margin-bottom: 12px;
}

.field-label {
  display: block;
  margin-bottom: 4px;
}

.field-input-wrapper {
  width: 100%;
}

.field-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--aimd-border-color, #90caf9);
  border-radius: 0 0 6px 6px;
  outline: none;
  font-size: 14px;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.field-input:focus {
  border-color: var(--aimd-border-color-focus, #4181fd);
  box-shadow: 0 0 0 2px rgba(65, 129, 253, 0.1);
}

.field-checkbox {
  width: 18px;
  height: 18px;
  accent-color: #4181fd;
}

.annotation-input {
  border-radius: 6px;
  border-color: #e0e0e0;
  font-size: 13px;
  padding: 6px 10px;
}

.step-field {
  background: #fff8f0;
  border: 1px solid #ffcc80;
  border-radius: 6px;
  padding: 12px;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.step-name {
  font-weight: 500;
  color: #e65100;
}

.step-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.step-check-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #666;
  cursor: pointer;
  white-space: nowrap;
}

.table-cell-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid #e0e0e0;
  border-radius: 3px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.table-cell-input:focus {
  border-color: #4181fd;
}

.code-output {
  padding: 16px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  line-height: 1.5;
  overflow: auto;
  max-height: 300px;
  white-space: pre-wrap;
  word-break: break-all;
  color: #333;
  margin: 0;
}
</style>
