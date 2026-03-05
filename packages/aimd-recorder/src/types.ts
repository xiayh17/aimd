export interface AimdStepOrCheckRecordItem {
  checked: boolean
  annotation: string
}

export interface AimdProtocolRecordData {
  var: Record<string, unknown>
  step: Record<string, AimdStepOrCheckRecordItem>
  check: Record<string, AimdStepOrCheckRecordItem>
  quiz: Record<string, unknown>
}

export function createEmptyProtocolRecordData(): AimdProtocolRecordData {
  return {
    var: {},
    step: {},
    check: {},
    quiz: {},
  }
}
