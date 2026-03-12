# @airalogy/aimd-recorder

`@airalogy/aimd-recorder` provides AIMD recorder styles and reusable data-input components.

## Install

```bash
pnpm add @airalogy/aimd-recorder @airalogy/aimd-core
```

## Main Capabilities

- Recorder UI styles via `@airalogy/aimd-recorder/styles`.
- Inline protocol recorder component: `AimdRecorder` (render + input in-place).
- Reusable quiz answer component: `AimdQuizRecorder`.
- Built-in var input handling for `CurrentTime`, `UserName`, `AiralogyMarkdown`.
- Input handling for `choice`, `blank`, and `open` quiz types.
- In recorder/edit mode, `ref_var` references display current var values as readonly inline content when available.

## Example

```vue
<script setup lang="ts">
import { ref } from "vue"
import {
  AimdRecorder,
  createEmptyProtocolRecordData,
  type AimdProtocolRecordData,
} from "@airalogy/aimd-recorder"
import "@airalogy/aimd-recorder/styles"

const content = ref(`# Protocol

Sample: {{var|sample_name: str}}
Operator: {{var|operator: UserName}}
Record Time: {{var|current_time: CurrentTime}}
Temperature: {{var|temperature: float = 25.0}}
Notes: {{var|notes: AiralogyMarkdown}}`)
const record = ref<AimdProtocolRecordData>(createEmptyProtocolRecordData())
</script>

<template>
  <AimdRecorder
    v-model="record"
    :content="content"
    locale="en-US"
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

## Locale

Both `AimdRecorder` and `AimdQuizRecorder` accept `locale` to switch built-in recorder labels:

```vue
<AimdRecorder locale="zh-CN" />
<AimdQuizRecorder :quiz="quiz" locale="zh-CN" />
```

## Advanced

If you need to fine-tune built-in recorder labels, override `messages`:

```vue
<script setup lang="ts">
import { AimdRecorder } from "@airalogy/aimd-recorder"
</script>

<template>
  <AimdRecorder
    locale="en-US"
    :messages="{
      step: {
        annotationPlaceholder: 'Step notes',
      },
      table: {
        addRow: 'Append row',
      },
    }"
  />
</template>
```

`AimdProtocolRecorder` is still exported as a deprecated compatibility alias, but new usage should prefer `AimdRecorder`.
