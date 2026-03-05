/**
 * @airalogy/aimd-recorder
 * 
 * AIMD editor Vue components and UI
 * 
 * This package provides Vue components for editing and displaying AIMD content
 */

// Re-export styles
import './styles/aimd.css'

export { AimdProtocolRecorder, AimdRecorder, AimdQuizRecorder } from './components'
export type { AimdProtocolRecordData, AimdStepOrCheckRecordItem } from './types'
export { createEmptyProtocolRecordData } from './types'
