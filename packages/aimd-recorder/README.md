# @airalogy/aimd-recorder

> AIMD editor Vue components and UI

## Overview

This package provides Vue UI and styles for AIMD.

## Installation

```bash
pnpm add @airalogy/aimd-recorder @airalogy/aimd-renderer @airalogy/aimd-core
```

## Features

-  **Styles** - Pre-built CSS for AIMD elements and editor UI
-  **Quiz Recorder** - Reusable quiz answer component (`choice` / `blank` / `open`)

## Usage

### Styles

```typescript
import '@airalogy/aimd-recorder/styles'
```

## Exports

### Main Entry (`@airalogy/aimd-recorder`)

- Side-effect import of `./styles/aimd.css` (also available via `@airalogy/aimd-recorder/styles`)
- Re-export of `AimdQuizRecorder`

### Components Entry (`@airalogy/aimd-recorder/components`)

- `AimdQuizRecorder`

```vue
<script setup lang="ts">
import { ref } from "vue"
import { AimdQuizRecorder } from "@airalogy/aimd-recorder/components"
import "@airalogy/aimd-recorder/styles"

const answer = ref("")
const quiz = {
  id: "quiz_single_1",
  type: "choice",
  mode: "single",
  stem: "Pick one option",
  options: [
    { key: "A", text: "Option A" },
    { key: "B", text: "Option B" },
  ],
}
</script>

<template>
  <AimdQuizRecorder v-model="answer" :quiz="quiz" />
</template>
```

### Composables Entry (`@airalogy/aimd-recorder/composables`)

Currently a placeholder entry with no public exports.

## Styles

Import the pre-built styles:

```typescript
import '@airalogy/aimd-recorder/styles'
```

Styles are built with:
- UnoCSS for utility-first CSS
- Dark mode support
- Responsive design
- Accessible UI components

## Development

### Scripts

```bash
# Type checking
pnpm type-check

# Build for production
pnpm build
```

### Dependencies

This package depends on:

- **@airalogy/aimd-core** - Core AIMD parser and types
- **@airalogy/aimd-renderer** - AIMD rendering engine
- **Vue 3** - Component framework
- **Naive UI** - UI component library (optional)
- **VueUse** - Vue composition utilities

## Architecture

All components follow:

- **Vue 3 Composition API** with `<script setup>`
- **TypeScript** for type safety
- **Reactive State** - Full reactive props and emits
- **Accessible** - ARIA labels and keyboard support
- **Themeable** - Support for light/dark modes

## Contributing

1. Follow Vue 3 Composition API patterns
2. Use TypeScript for all new components
3. Include JSDoc comments for public APIs
4. Add proper prop validation
5. Ensure components are responsive and accessible
6. Update README with new component documentation

## Related Packages

- **@airalogy/aimd-core** - Core AIMD parser and syntax
- **@airalogy/aimd-renderer** - AIMD rendering engine
- **@airalogy/aimd-editor** - Monaco Editor integration
- **@airalogy/components** - General-purpose UI components

## License

Part of the Airalogy monorepo. All rights reserved.
