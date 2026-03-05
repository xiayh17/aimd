# @airalogy/aimd-recorder

`@airalogy/aimd-recorder` provides AIMD recorder styles and reusable data-input components.

## Install

```bash
pnpm add @airalogy/aimd-recorder @airalogy/aimd-core
```

## Main Capabilities

- Recorder UI styles via `@airalogy/aimd-recorder/styles`.
- Inline protocol recorder component: `AimdProtocolRecorder` (render + input in-place).
- Reusable quiz answer component: `AimdQuizRecorder`.
- Built-in var input handling for `CurrentTime`, `UserName`, `AiralogyMarkdown`.
- Input handling for `choice`, `blank`, and `open` quiz types.

## Example

```vue
<script setup lang="ts">
import { ref } from "vue"
import {
  AimdProtocolRecorder,
  createEmptyProtocolRecordData,
  type AimdProtocolRecordData,
} from "@airalogy/aimd-recorder"
import "@airalogy/aimd-recorder/styles"

const content = ref(`# Protocol

Sample: {{var|sample_name: str}}
Operator: {{var|operator: UserName}}
Record Time: {{var|current_time: CurrentTime}}
Notes: {{var|notes: AiralogyMarkdown}}`)
const record = ref<AimdProtocolRecordData>(createEmptyProtocolRecordData())
</script>

<template>
  <AimdProtocolRecorder
    v-model="record"
    :content="content"
    current-user-name="Alice"
  />
</template>
```

`record` shape:

```json
{
  "var": {},
  "step": {},
  "check": {},
  "quiz": {}
}
```
