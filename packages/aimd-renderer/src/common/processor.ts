import type { Element, Properties, Root as HastRoot, Text as HastText } from "hast"
import type { Plugin } from "unified"
import type { VFile } from "vfile"
import type { VNode } from "vue"
import type {
  AimdNode,
  AimdQuizNode,
  AimdStepNode,
  ProcessorOptions,
} from "@airalogy/aimd-core/types"
import type { ExtractedAimdFields } from "@airalogy/aimd-core/types"
import type { AimdRendererI18nOptions } from "../locales"
import type { ShikiHighlighter, VueRendererOptions } from "../vue/vue-renderer"

/**
 * Render result
 */
export interface RenderResult {
  nodes: VNode[]
  fields: ExtractedAimdFields
}

export type AimdAssignerVisibility = "hidden" | "collapsed" | "expanded"

export interface AimdRendererOptions extends ProcessorOptions, AimdRendererI18nOptions {
  assignerVisibility?: AimdAssignerVisibility
}

import { toHtml } from "hast-util-to-html"
import rehypeKatex from "rehype-katex"
import rehypeRaw from "rehype-raw"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"

import { protectAimdInlineTemplates, remarkAimd } from "@airalogy/aimd-core/parser"
import {
  createAimdRendererMessages,
  getAimdRendererQuizTypeLabel,
  getAimdRendererScopeLabel,
} from "../locales"
import { renderToVNodes } from "../vue/vue-renderer"

let mathStylesLoadPromise: Promise<unknown> | null = null
let assignerHighlighterLoadPromise: Promise<ShikiHighlighter | null> | null = null
const ASSIGNER_HIGHLIGHT_THEME = "github-light"

interface MarkdownNode {
  type: string
  children?: MarkdownNode[]
  lang?: string | null
  meta?: string | null
  value?: string
}

type MarkdownParent = MarkdownNode & { children: MarkdownNode[] }

const EMPTY_EXTRACTED_FIELDS: ExtractedAimdFields = {
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

async function ensureMathStylesLoaded(mathEnabled: boolean | undefined): Promise<void> {
  if (mathEnabled === false) {
    return
  }
  if (typeof document === "undefined") {
    return
  }
  if (!mathStylesLoadPromise) {
    mathStylesLoadPromise = import("../styles/katex.css").catch(() => undefined)
  }
  await mathStylesLoadPromise
}

function createAimdParseInput(content: string) {
  const { content: protectedContent, templates } = protectAimdInlineTemplates(content)
  const file: VFile = {
    data: {
      aimdInlineTemplates: templates,
    },
  } as unknown as VFile

  return {
    content: protectedContent,
    file,
  }
}

function createEmptyExtractedFields(): ExtractedAimdFields {
  return {
    var: [...EMPTY_EXTRACTED_FIELDS.var],
    var_table: [...EMPTY_EXTRACTED_FIELDS.var_table],
    client_assigner: [...EMPTY_EXTRACTED_FIELDS.client_assigner],
    quiz: [...EMPTY_EXTRACTED_FIELDS.quiz],
    step: [...EMPTY_EXTRACTED_FIELDS.step],
    check: [...EMPTY_EXTRACTED_FIELDS.check],
    ref_step: [...EMPTY_EXTRACTED_FIELDS.ref_step],
    ref_var: [...EMPTY_EXTRACTED_FIELDS.ref_var],
    ref_fig: [...(EMPTY_EXTRACTED_FIELDS.ref_fig || [])],
    cite: [...(EMPTY_EXTRACTED_FIELDS.cite || [])],
    fig: [...(EMPTY_EXTRACTED_FIELDS.fig || [])],
  }
}

function getExtractedFields(file: VFile): ExtractedAimdFields {
  return (file.data.aimdFields as ExtractedAimdFields) || createEmptyExtractedFields()
}

function resolveAssignerVisibility(
  visibility: AimdRendererOptions["assignerVisibility"],
): AimdAssignerVisibility {
  switch (visibility) {
    case "collapsed":
    case "expanded":
      return visibility
    default:
      return "hidden"
  }
}

function isAssignerCodeNode(node: MarkdownNode): boolean {
  return node.type === "code" && (node.lang || "").trim().toLowerCase() === "assigner"
}

function getAssignerRuntime(meta: string | null | undefined): "client" | "server" {
  const runtime = String((meta || "").match(/\bruntime\s*=\s*([^\s]+)/)?.[1] || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .toLowerCase()
  return runtime === "client" ? "client" : "server"
}

function getRenderedAssignerLanguage(runtime: "client" | "server"): "javascript" | "python" {
  return runtime === "client" ? "javascript" : "python"
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function buildInlineStyle(declarations: Record<string, string>): string {
  return Object.entries(declarations)
    .map(([property, value]) => `${property}:${value}`)
    .join(";")
}

interface AssignerPreviewPresentation {
  badge: string
  containerStyle: string
  headerStyle: string
  titleStyle: string
  badgeStyle: string
  preStyle: string
  codeStyle: string
}

function getCollapsedAssignerPresentation(runtime: "client" | "server"): AssignerPreviewPresentation {
  const isClient = runtime === "client"
  const accent = isClient ? "#0f766e" : "#9a3412"
  const accentSoft = isClient ? "rgba(15, 118, 110, 0.08)" : "rgba(154, 52, 18, 0.08)"
  const border = "rgba(148, 163, 184, 0.26)"
  const codeBackground = "#f8fafc"
  const codeForeground = "#0f172a"
  const ruleColor = "rgba(148, 163, 184, 0.18)"

  return {
    badge: isClient ? "JS" : "PY",
    containerStyle: buildInlineStyle({
      margin: "0.85rem 0",
      border: `1px solid ${border}`,
      "border-radius": "12px",
      overflow: "hidden",
      background: "rgba(255, 255, 255, 0.92)",
    }),
    headerStyle: buildInlineStyle({
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: "0.7rem",
      padding: "0.6rem 0.8rem",
      "list-style": "none",
      background: "rgba(248, 250, 252, 0.92)",
      color: "#64748b",
      "font-weight": "600",
      "font-size": "0.86rem",
    }),
    titleStyle: buildInlineStyle({
      display: "inline-flex",
      "align-items": "center",
      gap: "0.45rem",
      "letter-spacing": "0.01em",
    }),
    badgeStyle: buildInlineStyle({
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      padding: "0.12rem 0.44rem",
      "min-width": "2rem",
      "border-radius": "999px",
      border: `1px solid ${accentSoft}`,
      background: accentSoft,
      color: accent,
      "font-size": "0.72rem",
      "font-weight": "700",
      "letter-spacing": "0.08em",
    }),
    preStyle: buildInlineStyle({
      margin: "0",
      padding: "0.8rem 0.85rem 0.9rem",
      overflow: "auto",
      background: codeBackground,
      border: "0",
      "border-top": `1px solid ${ruleColor}`,
      "tab-size": "2",
    }),
    codeStyle: buildInlineStyle({
      display: "block",
      color: codeForeground,
      background: "transparent",
      "font-family": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
      "font-size": "0.88rem",
      "line-height": "1.6",
      "white-space": "pre",
      padding: "0",
    }),
  }
}

function getExpandedAssignerPresentation(runtime: "client" | "server"): AssignerPreviewPresentation {
  const presentation = getCollapsedAssignerPresentation(runtime)
  return {
    ...presentation,
    containerStyle: buildInlineStyle({
      ...Object.fromEntries(presentation.containerStyle.split(";").filter(Boolean).map(rule => {
        const [property, value] = rule.split(":")
        return [property, value]
      })),
      margin: "1rem 0",
    }),
    headerStyle: buildInlineStyle({
      ...Object.fromEntries(presentation.headerStyle.split(";").filter(Boolean).map(rule => {
        const [property, value] = rule.split(":")
        return [property, value]
      })),
      cursor: "default",
    }),
  }
}

function createAssignerHeaderHtml(summary: string, presentation: AssignerPreviewPresentation): string {
  return `<span style="${presentation.titleStyle}">${escapeHtml(summary)}</span>`
    + `<span aria-hidden="true" style="${presentation.badgeStyle}">${presentation.badge}</span>`
}

function buildExpandedAssignerNode(
  value: string,
  runtime: "client" | "server",
  options: AimdRendererOptions,
): MarkdownNode {
  const messages = createAimdRendererMessages(options.locale, options.messages)
  const language = getRenderedAssignerLanguage(runtime)
  const summary = runtime === "client"
    ? messages.assigner.clientSummary
    : messages.assigner.serverSummary
  const presentation = getExpandedAssignerPresentation(runtime)

  return {
    type: "html",
    value:
      `<div class="aimd-assigner-preview aimd-assigner-preview--expanded aimd-assigner-preview--${runtime}" data-aimd-assigner-runtime="${runtime}" style="${presentation.containerStyle}">`
      + `<div style="${presentation.headerStyle}">`
      + createAssignerHeaderHtml(summary, presentation)
      + "</div>"
      + `<pre style="${presentation.preStyle}"><code class="language-${language}" style="${presentation.codeStyle}">${escapeHtml(value)}</code></pre>`
      + "</div>",
  }
}

function visitMarkdownParents(node: MarkdownNode, visitor: (parent: MarkdownParent) => void): void {
  if (!Array.isArray(node.children)) {
    return
  }

  const parent = node as MarkdownParent
  visitor(parent)

  for (const child of parent.children) {
    visitMarkdownParents(child, visitor)
  }
}

function buildCollapsedAssignerNode(
  value: string,
  runtime: "client" | "server",
  options: AimdRendererOptions,
): MarkdownNode {
  const messages = createAimdRendererMessages(options.locale, options.messages)
  const language = getRenderedAssignerLanguage(runtime)
  const summary = runtime === "client"
    ? messages.assigner.clientSummary
    : messages.assigner.serverSummary
  const presentation = getCollapsedAssignerPresentation(runtime)

  return {
    type: "html",
    value:
      `<details class="aimd-assigner-preview aimd-assigner-preview--collapsed aimd-assigner-preview--${runtime}" data-aimd-assigner-runtime="${runtime}" style="${presentation.containerStyle}">`
      + `<summary style="${presentation.headerStyle}">`
      + createAssignerHeaderHtml(summary, presentation)
      + "</summary>"
      + `<pre style="${presentation.preStyle}"><code class="language-${language}" style="${presentation.codeStyle}">${escapeHtml(value)}</code></pre>`
      + "</details>",
  }
}

const remarkInsertVisibleAssigners: Plugin<[AimdRendererOptions?], MarkdownNode> = (options = {}) => {
  return (tree) => {
    const visibility = resolveAssignerVisibility(options.assignerVisibility)
    if (visibility === "hidden") {
      return
    }

    visitMarkdownParents(tree, (parent) => {
      for (let index = 0; index < parent.children.length; index++) {
        const child = parent.children[index]
        if (!isAssignerCodeNode(child)) {
          continue
        }

        const runtime = getAssignerRuntime(child.meta)
        const replacement = visibility === "expanded"
          ? buildExpandedAssignerNode(child.value || "", runtime, options)
          : buildCollapsedAssignerNode(child.value || "", runtime, options)

        parent.children.splice(index, 0, replacement)
        index += 1
      }
    })
  }
}

function getClassNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string")
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim().split(/\s+/)
  }
  return []
}

function hasClassName(node: Element, className: string): boolean {
  return getClassNames(node.properties?.className).includes(className)
}

function getCodeLanguage(node: Element): string | null {
  const languageClass = getClassNames(node.properties?.className).find(name => name.startsWith("language-"))
  return languageClass ? languageClass.replace("language-", "") : null
}

function collectTextContent(node: Element): string {
  return node.children.map((child) => {
    if (child.type === "text") {
      return child.value
    }
    if (child.type === "element") {
      return collectTextContent(child)
    }
    return ""
  }).join("")
}

function visitHastElements(node: HastRoot | Element, visitor: (element: Element) => void): void {
  if (node.type === "element") {
    visitor(node)
  }

  const children = "children" in node ? node.children : []
  for (const child of children) {
    if (child.type === "element") {
      visitHastElements(child, visitor)
    }
  }
}

function findDescendantElement(node: Element, predicate: (element: Element) => boolean): Element | null {
  for (const child of node.children) {
    if (child.type !== "element") {
      continue
    }
    if (predicate(child)) {
      return child
    }
    const nested = findDescendantElement(child, predicate)
    if (nested) {
      return nested
    }
  }
  return null
}

function createHighlightedLineChildren(
  tokens: Array<{ content: string, variants: Record<string, { color: string }> }>,
): Array<Element | HastText> {
  if (tokens.length === 0) {
    return [{ type: "text", value: "\u00A0" }]
  }

  return tokens.map((token) => {
    const color = Object.values(token.variants || {}).find(variant => typeof variant?.color === "string")?.color
    return {
      type: "element",
      tagName: "span",
      properties: color ? { style: buildInlineStyle({ color }) } : {},
      children: [{ type: "text", value: token.content || " " }],
    } as Element
  })
}

async function getAssignerHighlighter(): Promise<ShikiHighlighter | null> {
  if (!assignerHighlighterLoadPromise) {
    assignerHighlighterLoadPromise = import("shiki")
      .then(async ({ createHighlighter }) => {
        const highlighter = await createHighlighter({
          themes: [ASSIGNER_HIGHLIGHT_THEME],
          langs: ["javascript", "python"],
        })
        return highlighter as unknown as ShikiHighlighter
      })
      .catch(() => null)
  }

  return assignerHighlighterLoadPromise
}

async function highlightVisibleAssigners(tree: HastRoot, options: AimdRendererOptions): Promise<void> {
  if (resolveAssignerVisibility(options.assignerVisibility) === "hidden") {
    return
  }

  const highlighter = await getAssignerHighlighter()
  if (!highlighter?.codeToTokensWithThemes) {
    return
  }

  visitHastElements(tree, (element) => {
    if (!hasClassName(element, "aimd-assigner-preview")) {
      return
    }

    const codeNode = findDescendantElement(element, candidate => candidate.tagName === "code")
    if (!codeNode || codeNode.properties?.["data-aimd-highlighted"] === "true") {
      return
    }

    const lang = getCodeLanguage(codeNode) || "text"
    const codeContent = collectTextContent(codeNode)
    const lines = highlighter.codeToTokensWithThemes?.(codeContent, {
      lang,
      themes: { light: ASSIGNER_HIGHLIGHT_THEME },
    }) || []

    codeNode.children = lines.map((lineTokens) => {
      return {
        type: "element",
        tagName: "span",
        properties: {
          className: ["aimd-assigner-code__line"],
          style: buildInlineStyle({ display: "block" }),
        },
        children: createHighlightedLineChildren(lineTokens),
      } as Element
    })
    codeNode.properties = {
      ...codeNode.properties,
      className: [...getClassNames(codeNode.properties?.className), "aimd-assigner-code"],
      "data-aimd-highlighted": "true",
    }
  })
}

const remarkStripAssignerCodeBlocks: Plugin<[], MarkdownNode> = () => {
  return (tree) => {
    visitMarkdownParents(tree, (parent) => {
      parent.children = parent.children.filter(child => !isAssignerCodeNode(child))
    })
  }
}

function buildStepSequenceMap(fields: ExtractedAimdFields): Map<string, string> {
  const sequenceMap = new Map<string, string>()

  for (const step of fields.stepHierarchy || []) {
    if (typeof step.id === "string" && step.id.trim() && typeof step.step === "string" && step.step.trim()) {
      sequenceMap.set(step.id, step.step)
    }
  }

  return sequenceMap
}

function annotateStepReferenceSequence(
  tree: HastRoot,
  fields: ExtractedAimdFields,
  options: AimdRendererOptions,
): void {
  const stepSequenceMap = buildStepSequenceMap(fields)
  if (stepSequenceMap.size === 0) {
    return
  }

  const messages = createAimdRendererMessages(options.locale, options.messages)

  const visitNode = (node: HastRoot | Element): void => {
    if (node.type === "element") {
      const element = node as Element
      const aimdType = element.properties?.["data-aimd-type"] || element.properties?.dataAimdType

      if (aimdType === "ref_step") {
        const refTarget = element.properties?.["data-aimd-id"] || element.properties?.dataAimdId
        if (typeof refTarget === "string") {
          const stepSequence = stepSequenceMap.get(refTarget)
          if (stepSequence) {
            element.properties["data-aimd-step-sequence"] = stepSequence
            element.properties.title = refTarget

            const aimdData = (element.data as { aimd?: AimdNode } | undefined)?.aimd
            if (aimdData) {
              ;(aimdData as any).stepSequence = stepSequence
            }

            const jsonData = element.properties["data-aimd-json"]
            if (typeof jsonData === "string") {
              try {
                const parsed = JSON.parse(jsonData) as Record<string, unknown>
                parsed.stepSequence = stepSequence
                element.properties["data-aimd-json"] = JSON.stringify(parsed)
              }
              catch {
                // Ignore malformed fallback JSON and keep runtime metadata only.
              }
            }

            element.children = [{
              type: "element",
              tagName: "span",
              properties: { className: ["aimd-ref__content"] },
              children: [{
                type: "element",
                tagName: "span",
                properties: { className: ["aimd-field", "aimd-field--step", "aimd-field--readonly"] },
                children: [{
                  type: "element",
                  tagName: "span",
                  properties: { className: ["research-step__sequence"] },
                  children: [{ type: "text", value: messages.step.reference(stepSequence) }],
                } as Element],
              } as Element],
            } as Element]
          }
        }
      }

      for (const child of element.children || []) {
        if (child.type === "element") {
          visitNode(child)
        }
      }
      return
    }

    for (const child of node.children) {
      if (child.type === "element") {
        visitNode(child)
      }
    }
  }

  visitNode(tree)
}

/**
 * Map field type to CSS class modifier (BEM format)
 */
function getFieldTypeClass(fieldType: AimdNode["fieldType"]): string {
  switch (fieldType) {
    case "var_table":
      return "var-table"
    default:
      return fieldType
  }
}

interface ResolvedQuizPreviewOptions {
  showAnswers: boolean
  showRubric: boolean
}

const BLANK_PLACEHOLDER_PATTERN = /\[\[([^\[\]\s]+)\]\]/g

function resolveQuizPreviewOptions(
  options: Pick<ProcessorOptions, "mode" | "quizPreview">,
): ResolvedQuizPreviewOptions {
  const mode = options.mode ?? "preview"
  const defaultReveal = mode === "report"
  return {
    showAnswers: options.quizPreview?.showAnswers ?? defaultReveal,
    showRubric: options.quizPreview?.showRubric ?? defaultReveal,
  }
}

function buildQuizStemChildren(
  quizType: AimdQuizNode["quizType"],
  stem: string,
): Array<Element | HastText> {
  if (quizType !== "blank") {
    return [{ type: "text", value: stem }]
  }

  const children: Array<Element | HastText> = []
  let lastIndex = 0

  for (const match of stem.matchAll(BLANK_PLACEHOLDER_PATTERN)) {
    const start = match.index ?? 0
    const fullMatch = match[0]
    const key = match[1]

    if (start > lastIndex) {
      children.push({
        type: "text",
        value: stem.slice(lastIndex, start),
      })
    }

    children.push({
      type: "element",
      tagName: "span",
      properties: {
        className: ["aimd-quiz__blank-placeholder"],
        "data-blank-key": key,
      },
      children: [{ type: "text", value: key }],
    } as Element)

    lastIndex = start + fullMatch.length
  }

  if (lastIndex < stem.length) {
    children.push({
      type: "text",
      value: stem.slice(lastIndex),
    })
  }

  if (children.length === 0) {
    children.push({ type: "text", value: stem })
  }

  return children
}

/**
 * Custom handler for AIMD nodes in remark-rehype
 * Converts MDAST AIMD nodes to HAST elements
 */
function createAimdHandler(options: AimdRendererOptions = {}) {
  const quizPreview = resolveQuizPreviewOptions(options)
  const messages = createAimdRendererMessages(options.locale, options.messages)

  return function aimdHandler(state: any, node: AimdNode): Element {
  // Build full node data including step hierarchy
  const nodeData: Record<string, unknown> = {
    type: node.type,
    fieldType: node.fieldType,
    id: node.id,
    scope: node.scope,
    raw: node.raw,
  }

  // Add type-specific fields
  if ("definition" in node)
    nodeData.definition = node.definition
  if ("columns" in node)
    nodeData.columns = node.columns
  if ("label" in node)
    nodeData.label = node.label
  if ("refTarget" in node)
    nodeData.refTarget = node.refTarget
  if ("checkedMessage" in node)
    nodeData.checkedMessage = node.checkedMessage

  // Add quiz-specific fields
  if (node.fieldType === "quiz") {
    const quizNode = node as AimdQuizNode
    nodeData.quizType = quizNode.quizType
    nodeData.stem = quizNode.stem
    nodeData.score = quizNode.score
    nodeData.mode = quizNode.mode
    nodeData.options = quizNode.options
    nodeData.answer = quizNode.answer
    nodeData.blanks = quizNode.blanks
    nodeData.rubric = quizNode.rubric
    nodeData.default = quizNode.default
    nodeData.extra = quizNode.extra
  }

  // Add fig-specific fields
  if (node.fieldType === "fig") {
    const figNode = node as any
    nodeData.id = figNode.id
    nodeData.src = figNode.src
    nodeData.title = figNode.title
    nodeData.legend = figNode.legend
    nodeData.sequence = figNode.sequence
  }

  // Add step-specific fields
  if (node.fieldType === "step") {
    const stepNode = node as AimdStepNode
    nodeData.level = stepNode.level
    nodeData.sequence = stepNode.sequence
    nodeData.step = stepNode.step
    nodeData.parentId = stepNode.parentId
    nodeData.prevId = stepNode.prevId
    nodeData.nextId = stepNode.nextId
    nodeData.hasChildren = stepNode.hasChildren
    nodeData.check = stepNode.check
  }

  // Serialize AIMD node data to JSON for preservation through rehypeRaw
  const aimdJson = JSON.stringify(nodeData)

  const fieldType = node.fieldType
  const id = node.id
  const typeClass = getFieldTypeClass(fieldType)

  // Determine if this is a reference type
  const isRef = fieldType === "ref_step" || fieldType === "ref_var" || fieldType === "ref_fig"
  const isCite = fieldType === "cite"
  const isQuiz = fieldType === "quiz"
  const isFig = fieldType === "fig"
  const baseClass = isRef
    ? "aimd-ref"
    : (isCite ? "aimd-cite" : (isFig ? "aimd-figure" : "aimd-field"))
  const modifierClass = isRef
    ? `aimd-ref--${fieldType === "ref_step" ? "step" : (fieldType === "ref_var" ? "var" : "fig")}`
    : (isCite ? "" : (isFig ? "" : `aimd-field--${typeClass}`))

  // Generate children based on field type
  const children: (Element | HastText)[] = []

  if (isRef) {
    // Reference: blockquote-style with appropriate content
    if (fieldType === "ref_step") {
      // Step reference: render with step-like field styling, then patch localized sequence later.
      children.push({
        type: "element",
        tagName: "span",
        properties: { className: ["aimd-ref__content"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["aimd-field", "aimd-field--step", "aimd-field--readonly"] },
            children: [{
              type: "element",
              tagName: "span",
              properties: { className: ["research-step__sequence"] },
              children: [{ type: "text", value: id }],
            } as Element],
          } as Element,
        ],
      } as Element)
    }
    else {
      // Variable or figure reference: show as field with scope + id
      const scopeLabel = fieldType === "ref_var" ? messages.scope.var : messages.scope.figure
      children.push({
        type: "element",
        tagName: "span",
        properties: { className: ["aimd-ref__content"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["aimd-field", "aimd-field--var"] },
            children: [
              {
                type: "element",
                tagName: "span",
                properties: { className: ["aimd-field__scope"] },
                children: [{ type: "text", value: scopeLabel }],
              } as Element,
              {
                type: "element",
                tagName: "span",
                properties: { className: ["aimd-field__name"] },
                children: [{ type: "text", value: id }],
              } as Element,
            ],
          } as Element,
        ],
      } as Element)
    }
  }
  else if (isCite) {
    // Citation: [refs]
    const refs = "refs" in node ? (node as any).refs : [id]
    children.push({
      type: "element",
      tagName: "span",
      properties: { className: ["aimd-cite__refs"] },
      children: [{ type: "text", value: `[${refs.join(", ")}]` }],
    } as Element)
  }
  else if (fieldType === "var") {
    // Variable: type label + id + optional type annotation
    const definition = "definition" in node ? node.definition : undefined
    children.push(
      {
        type: "element",
        tagName: "span",
        properties: { className: ["aimd-field__scope"] },
        children: [{ type: "text", value: getAimdRendererScopeLabel("var", messages) }],
      } as Element,
      {
        type: "element",
        tagName: "span",
        properties: { className: ["aimd-field__name"] },
        children: [{ type: "text", value: id }],
      } as Element,
    )
    if (definition?.type) {
      children.push({
        type: "element",
        tagName: "span",
        properties: { className: ["aimd-field__type"] },
        children: [{ type: "text", value: `: ${definition.type}` }],
      } as Element)
    }
  }
  else if (fieldType === "var_table") {
    // var_table: render header + table preview
    const columns = "columns" in node ? (node as any).columns as string[] : []
    children.push(
      {
        type: "element",
        tagName: "div",
        properties: { className: ["aimd-field__header"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["aimd-field__scope"] },
            children: [{ type: "text", value: getAimdRendererScopeLabel("var_table", messages) }],
          } as Element,
          {
            type: "element",
            tagName: "span",
            properties: { className: ["aimd-field__name"] },
            children: [{ type: "text", value: id }],
          } as Element,
        ],
      } as Element,
    )
    if (columns && columns.length > 0) {
      children.push({
        type: "element",
        tagName: "table",
        properties: { className: ["aimd-field__table-preview"] },
        children: [
          {
            type: "element",
            tagName: "thead",
            properties: {},
            children: [
              {
                type: "element",
                tagName: "tr",
                properties: {},
                children: columns.map(col => ({
                  type: "element",
                  tagName: "th",
                  properties: {},
                  children: [{ type: "text", value: col }],
                } as Element)),
              } as Element,
            ],
          } as Element,
          {
            type: "element",
            tagName: "tbody",
            properties: {},
            children: [
              {
                type: "element",
                tagName: "tr",
                properties: {},
                children: columns.map(() => ({
                  type: "element",
                  tagName: "td",
                  properties: {},
                  children: [{ type: "text", value: "..." }],
                } as Element)),
              } as Element,
            ],
          } as Element,
        ],
      } as Element)
    }
  }
  else if (fieldType === "step") {
    // Step: scope label + sequence + id
    const stepNode = node as AimdStepNode
    const stepNum = stepNode.step || "1"

    children.push(
      {
        type: "element",
        tagName: "span",
        properties: { className: ["aimd-field__scope"] },
        children: [{ type: "text", value: getAimdRendererScopeLabel("step", messages) }],
      } as Element,
      {
        type: "element",
        tagName: "span",
        properties: { className: ["aimd-field__step-num"] },
        children: [{ type: "text", value: stepNum }],
      } as Element,
      {
        type: "element",
        tagName: "span",
        properties: { className: ["aimd-field__name"] },
        children: [{ type: "text", value: id }],
      } as Element,
    )
  }
  else if (fieldType === "check") {
    // Check: checkbox + label
    const label = "label" in node ? node.label : id
    children.push(
      {
        type: "element",
        tagName: "input",
        properties: { type: "checkbox", className: ["aimd-checkbox"], disabled: true },
        children: [],
      } as Element,
      {
        type: "element",
        tagName: "span",
        properties: { className: ["aimd-field__label"] },
        children: [{ type: "text", value: label || id }],
      } as Element,
    )
  }
  else if (fieldType === "quiz") {
    const quizNode = node as AimdQuizNode
    const quizType = quizNode.quizType
    const typeLabel = getAimdRendererQuizTypeLabel(quizType, quizNode.mode, messages)

    children.push(
      {
        type: "element",
        tagName: "div",
        properties: { className: ["aimd-quiz__meta"] },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["aimd-field__scope"] },
            children: [{ type: "text", value: getAimdRendererScopeLabel("quiz", messages) }],
          } as Element,
          {
            type: "element",
            tagName: "span",
            properties: { className: ["aimd-field__name"] },
            children: [{ type: "text", value: id }],
          } as Element,
          {
            type: "element",
            tagName: "span",
            properties: { className: ["aimd-field__type"] },
            children: [{ type: "text", value: `(${typeLabel})` }],
          } as Element,
          ...(quizNode.score !== undefined
            ? [{
                type: "element",
                tagName: "span",
                properties: { className: ["aimd-quiz__score"] },
                children: [{ type: "text", value: messages.quiz.score(quizNode.score) }],
              } as Element]
            : []),
        ],
      } as Element,
      {
        type: "element",
        tagName: "div",
        properties: { className: ["aimd-quiz__stem"] },
        children: buildQuizStemChildren(quizType, quizNode.stem),
      } as Element,
    )

    if (quizType === "choice" && Array.isArray(quizNode.options) && quizNode.options.length > 0) {
      children.push({
        type: "element",
        tagName: "ul",
        properties: { className: ["aimd-quiz__options"] },
        children: quizNode.options.map(option => ({
          type: "element",
          tagName: "li",
          properties: {},
          children: [{ type: "text", value: `${option.key}. ${option.text}` }],
        } as Element)),
      } as Element)
    }

    if (quizPreview.showAnswers && quizType === "choice" && quizNode.answer !== undefined) {
      const answerText = Array.isArray(quizNode.answer)
        ? quizNode.answer.join(", ")
        : String(quizNode.answer)
      if (answerText.trim()) {
        children.push({
          type: "element",
          tagName: "div",
          properties: { className: ["aimd-quiz__answer"] },
          children: [{ type: "text", value: messages.quiz.answer(answerText) }],
        } as Element)
      }
    }

    if (quizPreview.showAnswers && quizType === "blank" && Array.isArray(quizNode.blanks) && quizNode.blanks.length > 0) {
      children.push({
        type: "element",
        tagName: "ul",
        properties: { className: ["aimd-quiz__blanks"] },
        children: quizNode.blanks.map(blank => ({
          type: "element",
          tagName: "li",
          properties: {},
          children: [{ type: "text", value: `${blank.key}: ${blank.answer}` }],
        } as Element)),
      } as Element)
    }

    if (quizPreview.showRubric && quizType === "open" && typeof quizNode.rubric === "string" && quizNode.rubric.trim()) {
      children.push({
        type: "element",
        tagName: "div",
        properties: { className: ["aimd-quiz__rubric"] },
        children: [{ type: "text", value: messages.quiz.rubric(quizNode.rubric) }],
      } as Element)
    }
  }
  else if (fieldType === "fig") {
    // Figure: image + title + legend
    const figNode = node as any
    const figId = figNode.id || id
    const figSrc = figNode.src || ""
    const figTitle = figNode.title
    const figLegend = figNode.legend

    // Create img element
    children.push({
      type: "element",
      tagName: "img",
      properties: {
        src: figSrc,
        alt: figTitle || figId,
        className: ["aimd-figure__image"],
      },
      children: [],
    } as Element)

    // Create figcaption if title or legend exists
    if (figTitle || figLegend) {
      const captionChildren: (Element | HastText)[] = []

      if (figTitle) {
        captionChildren.push({
          type: "element",
          tagName: "div",
          properties: { className: ["aimd-figure__title"] },
          children: [{ type: "text", value: figTitle }],
        } as Element)
      }

      if (figLegend) {
        captionChildren.push({
          type: "element",
          tagName: "div",
          properties: { className: ["aimd-figure__legend"] },
          children: [{ type: "text", value: figLegend }],
        } as Element)
      }

      children.push({
        type: "element",
        tagName: "figcaption",
        properties: { className: ["aimd-figure__caption"] },
        children: captionChildren,
      } as Element)
    }
  }

  // Build properties
  const properties: Properties = {
    "className": [baseClass, modifierClass],
    "data-aimd-type": node.fieldType,
    "data-aimd-id": node.id,
    "data-aimd-scope": node.scope,
    "data-aimd-raw": node.raw,
    "data-aimd-json": aimdJson,
  }

  // Add reference href
  if (isRef) {
    if (fieldType === "ref_step") {
      properties.href = `#step-${id}`
    }
    else if (fieldType === "ref_var") {
      properties.href = `#var-${id}`
    }
    else if (fieldType === "ref_fig") {
      properties.href = `#fig-${id}`
    }
  }

  // Add step-specific properties
  if (node.fieldType === "step") {
    const stepNode = node as AimdStepNode
    properties["data-aimd-step"] = stepNode.step
    properties["data-aimd-level"] = stepNode.level
    properties.id = `step-${id}`
  }

  // Add check id
  if (node.fieldType === "check") {
    properties.id = `check-${id}`
  }

  // Add var id
  if (node.fieldType === "var") {
    properties.id = `var-${id}`
  }

  // Add var_table id
  if (node.fieldType === "var_table") {
    properties.id = `var_table-${id}`
  }

  // Add quiz id
  if (node.fieldType === "quiz") {
    properties.id = `quiz-${id}`
  }

  // Add fig id
  if (node.fieldType === "fig") {
    const figNode = node as any
    properties.id = `fig-${figNode.id || id}`
    properties["data-aimd-fig-id"] = figNode.id
    properties["data-aimd-fig-src"] = figNode.src
  }

  // Add quiz metadata for fallback reconstruction
  if (node.fieldType === "quiz") {
    const quizNode = node as AimdQuizNode
    properties["data-aimd-quiz-type"] = quizNode.quizType
    properties["data-aimd-quiz-stem"] = quizNode.stem
  }

  const element: Element = {
    type: "element",
    tagName: isRef ? "a" : (isFig ? "figure" : ((fieldType === "var_table" || isQuiz) ? "div" : "span")),
    properties,
    children,
  }
  // Store AIMD data for Vue renderer (may be lost after rehypeRaw)
  ;(element as any).data = { aimd: node }
  return element
  }
}

/**
 * Create base processor
 */
function createBaseProcessor(options: AimdRendererOptions = {}) {
  const { gfm = true, math = true, breaks = true } = options

  const processor = unified()
    .use(remarkParse)

  // GFM support (tables, strikethrough, task lists, etc.)
  if (gfm) {
    processor.use(remarkGfm)
  }

  // Math formula support
  if (math) {
    processor.use(remarkMath)
  }

  processor.use(remarkInsertVisibleAssigners, options)

  // AIMD syntax support - MUST run before remarkBreaks
  // to properly parse multiline AIMD syntax like var_table with subvars
  processor.use(remarkAimd)
  processor.use(remarkStripAssignerCodeBlocks)

  // Single line break to <br> conversion (default enabled for AIMD)
  if (breaks) {
    processor.use(remarkBreaks)
  }

  return processor
}

/**
 * Create HTML output processor
 */
export function createHtmlProcessor(options: AimdRendererOptions = {}) {
  const { math = true, sanitize = true } = options
  const aimdHandler = createAimdHandler(options)

  const processor = createBaseProcessor(options)
    .use(remarkRehype, {
      allowDangerousHtml: true,
      handlers: {
        // Custom handler for AIMD nodes
        aimd: aimdHandler,
      },
    } as any)
    .use(rehypeRaw)

  // Math formula rendering
  if (math) {
    processor.use(rehypeKatex)
  }

  return processor
}

/**
 * Render Markdown/AIMD to HTML string
 */
export async function renderToHtml(
  content: string,
  options: AimdRendererOptions = {},
): Promise<{ html: string, fields: ExtractedAimdFields }> {
  await ensureMathStylesLoaded(options.math)
  const processor = createHtmlProcessor(options)

  const { content: protectedContent, file } = createAimdParseInput(content)
  const tree = processor.parse(protectedContent)
  const hastTree = await processor.run(tree, file) as HastRoot

  const fields = getExtractedFields(file)
  annotateStepReferenceSequence(hastTree, fields, options)
  await highlightVisibleAssigners(hastTree, options)
  const html = toHtml(hastTree, { allowDangerousHtml: true })

  return { html, fields }
}

/**
 * Render Markdown/AIMD to Vue VNodes
 */
export async function renderToVue(
  content: string,
  options: AimdRendererOptions & VueRendererOptions = {},
): Promise<RenderResult> {
  await ensureMathStylesLoaded(options.math)
  const processor = createHtmlProcessor(options)

  const { content: protectedContent, file } = createAimdParseInput(content)
  const tree = processor.parse(protectedContent)
  const hastTree = await processor.run(tree, file) as HastRoot

  const fields = getExtractedFields(file)
  annotateStepReferenceSequence(hastTree, fields, options)
  await highlightVisibleAssigners(hastTree, options)
  const nodes = renderToVNodes(hastTree, options)

  return { nodes, fields }
}

/**
 * Parse Markdown/AIMD and extract field information (no rendering)
 */
export function parseAndExtract(content: string): ExtractedAimdFields {
  const processor = unified()
    .use(remarkParse)
    .use(remarkAimd)

  const { content: protectedContent, file } = createAimdParseInput(content)
  const tree = processor.parse(protectedContent)
  processor.runSync(tree, file)

  return getExtractedFields(file)
}

/**
 * Synchronous render to HTML (for simple scenarios)
 */
export function renderToHtmlSync(
  content: string,
  options: AimdRendererOptions = {},
): { html: string, fields: ExtractedAimdFields } {
  // Sync mode does not support KaTeX stylesheet loading, so keep math disabled here.
  const processor = createHtmlProcessor({ ...options, math: false })

  const { content: protectedContent, file } = createAimdParseInput(content)
  const tree = processor.parse(protectedContent)
  const hastTree = processor.runSync(tree, file) as HastRoot

  const fields = getExtractedFields(file)
  annotateStepReferenceSequence(hastTree, fields, options)
  const html = toHtml(hastTree, { allowDangerousHtml: true })

  return { html, fields }
}

/**
 * Create reusable renderer instance
 */
export function createRenderer(options: AimdRendererOptions = {}) {
  const processor = createHtmlProcessor(options)

  return {
    /**
     * Render to HTML
     */
    async toHtml(content: string): Promise<{ html: string, fields: ExtractedAimdFields }> {
      return renderToHtml(content, options)
    },

    /**
     * Render to Vue VNodes
     */
    async toVue(
      content: string,
      renderOptions?: VueRendererOptions,
    ): Promise<RenderResult> {
      return renderToVue(content, { ...options, ...renderOptions })
    },

    /**
     * Extract fields only
     */
    extractFields(content: string): ExtractedAimdFields {
      return parseAndExtract(content)
    },
  }
}

// Export default renderer
export const defaultRenderer = createRenderer()
