export { captureFocusSnapshot, restoreFocusSnapshot } from './useFocusManagement'
export type { FocusSnapshot } from './useFocusManagement'

export {
  cloneRecordData,
  normalizeStepLike,
  normalizeIncomingRecord,
  replaceSection,
  applyNormalizedRecord,
  applyIncomingRecord,
  normalizeStepFields,
  normalizeCheckFields,
  normalizeQuizFields,
  normalizeVarTableFields,
  getQuizDefaultValue,
  ensureDefaultsFromFields,
  createEmptyVarTableRow,
  normalizeVarTableRows,
} from './useRecordState'

export {
  normalizeVarTypeName,
  getVarInputKind,
  unwrapStructuredValue,
  toBooleanValue,
  toDateValue,
  formatDateTimeWithTimezone,
  normalizeDateTimeValueWithTimezone,
  formatDateForInput,
  getVarInputDisplayValue,
  parseVarInputValue,
  calculateVarStackWidth,
  measureVarLabelWidth,
  measureSingleLineControlWidth,
  syncAutoWrapTextareaHeight,
  applyVarStackWidth,
} from './useVarHelpers'
export type { VarInputKind } from './useVarHelpers'
