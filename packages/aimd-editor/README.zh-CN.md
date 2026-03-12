# @airalogy/aimd-editor

面向 AIMD 的编辑工具包（Monaco + Vue，可视化/源码双模式）。

## 安装

```bash
pnpm add @airalogy/aimd-editor monaco-editor
```

## 快速开始

```ts
import * as monaco from "monaco-editor"
import { language, conf, completionItemProvider } from "@airalogy/aimd-editor/monaco"

monaco.languages.register({ id: "aimd" })
monaco.languages.setMonarchTokensProvider("aimd", language)
monaco.languages.setLanguageConfiguration("aimd", conf)
monaco.languages.registerCompletionItemProvider("aimd", completionItemProvider)
```

## Vue 编辑器 i18n

```vue
<script setup lang="ts">
import { AimdEditor } from "@airalogy/aimd-editor"
</script>

<template>
  <AimdEditor locale="zh-CN" />
</template>
```

也可以通过 `messages` 覆盖内建文案。

## 文档

- EN: <https://airalogy.github.io/aimd/en/packages/aimd-editor>
- 中文: <https://airalogy.github.io/aimd/zh/packages/aimd-editor>
- 文档源码：`aimd/docs/en/packages/aimd-editor.md`、`aimd/docs/zh/packages/aimd-editor.md`
