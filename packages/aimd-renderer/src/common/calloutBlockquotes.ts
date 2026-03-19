import type { Element, ElementContent, Root as HastRoot, Text as HastText } from "hast"
import type { AimdRendererOptions } from "./processor"
import { createAimdRendererMessages } from "../locales"

type HastChild = Element | HastText
type CalloutKind
  = "note"
  | "tip"
  | "warning"
  | "caution"
  | "important"
  | "example"
  | "abstract"
  | "info"
  | "success"
  | "danger"
  | "bug"
  | "quote"
type CalloutIconName
  = "note"
  | "example"
  | "info"
  | "abstract"
  | "tip"
  | "important"
  | "warning"
  | "caution"
  | "success"
  | "danger"
  | "bug"
  | "quote"
  | "document"
  | "bookmark"
  | "beaker"
  | "spark"
  | "check-circle"
  | "triangle-alert"
  | "bug-outline"
  | "quote-mark"

interface ResolvedCalloutMarker {
  kind: CalloutKind
  explicitTitle: string | null
  trailingText: string
  collapsible: boolean
  collapsed: boolean
  icon: CalloutIconName | null
}

interface ResolvedCalloutContent extends ResolvedCalloutMarker {
  titleChildren: HastChild[]
  bodyPrefixChildren: HastChild[]
}

const CALLOUT_KINDS = new Set<CalloutKind>([
  "note",
  "tip",
  "warning",
  "caution",
  "important",
  "example",
  "abstract",
  "info",
  "success",
  "danger",
  "bug",
  "quote",
])
const CALLOUT_ICONS = new Set<CalloutIconName>([
  "note",
  "example",
  "info",
  "abstract",
  "tip",
  "important",
  "warning",
  "caution",
  "success",
  "danger",
  "bug",
  "quote",
  "document",
  "bookmark",
  "beaker",
  "spark",
  "check-circle",
  "triangle-alert",
  "bug-outline",
  "quote-mark",
])

function getClassNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string")
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim().split(/\s+/)
  }
  return []
}

function isParagraph(node: ElementContent | undefined): node is Element {
  return node?.type === "element" && node.tagName === "p"
}

function isText(node: ElementContent | undefined): node is HastText {
  return node?.type === "text"
}

function isBlankText(node: ElementContent | undefined): boolean {
  return isText(node) && node.value.trim().length === 0
}

function findMeaningfulChildIndex(children: ElementContent[], start = 0): number {
  for (let index = start; index < children.length; index += 1) {
    const child = children[index]
    if (child.type === "comment" || isBlankText(child)) {
      continue
    }
    return index
  }
  return -1
}

function toRenderableChildren(children: ElementContent[]): HastChild[] {
  return children.filter((child): child is HastChild => child.type === "element" || child.type === "text")
}

function trimTextEdges(children: ElementContent[]): HastChild[] {
  const nextChildren = [...toRenderableChildren(children)]

  while (true) {
    const firstChild = nextChildren[0]
    if (!isText(firstChild)) {
      break
    }

    const trimmed = firstChild.value.replace(/^\s+/, "")
    if (trimmed.length === 0) {
      nextChildren.shift()
      continue
    }
    nextChildren[0] = { ...firstChild, value: trimmed }
    break
  }

  while (true) {
    const lastIndex = nextChildren.length - 1
    const lastChild = nextChildren[lastIndex]
    if (!isText(lastChild)) {
      break
    }

    const trimmed = lastChild.value.replace(/\s+$/, "")
    if (trimmed.length === 0) {
      nextChildren.pop()
      continue
    }
    nextChildren[lastIndex] = { ...lastChild, value: trimmed }
    break
  }

  return nextChildren
}

function createTextNode(value: string): HastText {
  return {
    type: "text",
    value,
  }
}

function splitAttributeEntries(value: string): string[] {
  const entries: string[] = []
  let current = ""
  let quote: "'" | "\"" | null = null

  for (const char of value) {
    if ((char === "\"" || char === "'") && quote === null) {
      quote = char
      current += char
      continue
    }

    if (char === quote) {
      quote = null
      current += char
      continue
    }

    if (char === "," && quote === null) {
      if (current.trim()) {
        entries.push(current.trim())
      }
      current = ""
      continue
    }

    current += char
  }

  if (current.trim()) {
    entries.push(current.trim())
  }

  return entries
}

function normalizeAttributeValue(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseBooleanAttribute(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) {
    return defaultValue
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true
    case "0":
    case "false":
    case "no":
    case "off":
      return false
    default:
      return defaultValue
  }
}

function parseAttributeBlock(value: string): { attributes: Record<string, string | boolean>, remainder: string } {
  const match = value.match(/^\s*\{([^}]*)\}\s*(.*)$/)
  if (!match) {
    return { attributes: {}, remainder: value }
  }

  const attributes: Record<string, string | boolean> = {}
  for (const entry of splitAttributeEntries(match[1])) {
    const separatorIndex = entry.indexOf("=")
    if (separatorIndex < 0) {
      attributes[entry.trim().toLowerCase()] = true
      continue
    }

    const key = entry.slice(0, separatorIndex).trim().toLowerCase()
    const rawValue = normalizeAttributeValue(entry.slice(separatorIndex + 1))
    if (!key) {
      continue
    }
    attributes[key] = rawValue
  }

  return {
    attributes,
    remainder: match[2] || "",
  }
}

function resolveCalloutKind(rawKind: string): CalloutKind | null {
  const normalized = rawKind.trim().toLowerCase()
  if (normalized === "info") {
    return "info"
  }
  if (normalized === "abstract") {
    return "abstract"
  }
  if (CALLOUT_KINDS.has(normalized as CalloutKind)) {
    return normalized as CalloutKind
  }
  return null
}

function resolveCalloutIcon(value: string | boolean | undefined, kind: CalloutKind): CalloutIconName {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase() as CalloutIconName
    if (CALLOUT_ICONS.has(normalized)) {
      return normalized
    }
  }
  return kind
}

function resolveCalloutMarker(text: string): ResolvedCalloutMarker | null {
  const match = text.match(/^\s*\[!([A-Z]+)(?:\|([^\]]+))?\](.*)$/i)
  if (!match) {
    return null
  }

  const kind = resolveCalloutKind(match[1])
  if (!kind) {
    return null
  }

  const bracketTitle = match[2]?.trim() || null
  const parsedAttrs = parseAttributeBlock(match[3] || "")
  const explicitTitle = typeof parsedAttrs.attributes.title === "string"
    ? parsedAttrs.attributes.title
    : bracketTitle
  const collapsible = parseBooleanAttribute(parsedAttrs.attributes.collapsible as string | undefined, false)
  const collapsed = collapsible && parseBooleanAttribute(parsedAttrs.attributes.collapsed as string | undefined, false)

  return {
    kind,
    explicitTitle: explicitTitle?.trim() || null,
    trailingText: parsedAttrs.remainder,
    collapsible,
    collapsed,
    icon: resolveCalloutIcon(parsedAttrs.attributes.icon, kind),
  }
}

function resolveCalloutContent(firstParagraph: Element): ResolvedCalloutContent | null {
  const [firstChild, ...restChildren] = firstParagraph.children
  if (!isText(firstChild)) {
    return null
  }

  const marker = resolveCalloutMarker(firstChild.value)
  if (!marker) {
    return null
  }

  const trailingChildren = trimTextEdges([
    ...(marker.trailingText.trim().length > 0 ? [createTextNode(marker.trailingText)] : []),
    ...restChildren,
  ])

  return {
    ...marker,
    titleChildren: marker.explicitTitle ? [createTextNode(marker.explicitTitle)] : trailingChildren,
    bodyPrefixChildren: marker.explicitTitle ? trailingChildren : [],
  }
}

function createCalloutTitleElement(
  resolved: ResolvedCalloutContent,
  badgeLabel: string,
  titleChildren: HastChild[],
): Element {
  const tagName = resolved.collapsible ? "summary" : "div"

  return {
    type: "element",
    tagName,
    properties: {
      className: [
        "aimd-callout__title",
        ...(resolved.collapsible ? ["aimd-callout__title--interactive"] : []),
        ...(titleChildren.length === 0 ? ["aimd-callout__title--badge-only"] : []),
      ],
    },
    children: [
      {
        type: "element",
        tagName: "span",
        properties: {
          className: ["aimd-callout__badge", `aimd-callout__badge--${resolved.kind}`],
          "data-aimd-callout-icon": resolved.icon || resolved.kind,
        },
        children: [
          {
            type: "element",
            tagName: "span",
            properties: {
              className: ["aimd-callout__badge-icon"],
              "aria-hidden": "true",
            },
            children: [],
          },
          {
            type: "element",
            tagName: "span",
            properties: { className: ["aimd-callout__badge-label"] },
            children: [createTextNode(badgeLabel)],
          },
        ],
      },
      ...(titleChildren.length > 0
        ? [{
            type: "element",
            tagName: "span",
            properties: { className: ["aimd-callout__title-text"] },
            children: titleChildren,
          } as Element]
        : []),
      ...(resolved.collapsible
        ? [{
            type: "element",
            tagName: "span",
            properties: {
              className: ["aimd-callout__toggle"],
              "aria-hidden": "true",
            },
            children: [],
          } as Element]
        : []),
    ],
  }
}

function createCalloutBodyElement(children: HastChild[]): Element {
  return {
    type: "element",
    tagName: "div",
    properties: { className: ["aimd-callout__body"] },
    children,
  }
}

function transformBlockquoteToCallout(
  element: Element,
  options: AimdRendererOptions,
): void {
  if (element.tagName !== "blockquote") {
    return
  }

  const classNames = getClassNames(element.properties?.className)
  if (classNames.includes("aimd-callout")) {
    return
  }

  const firstContentIndex = findMeaningfulChildIndex(element.children)
  if (firstContentIndex < 0) {
    return
  }

  const firstChild = element.children[firstContentIndex]
  if (!isParagraph(firstChild)) {
    return
  }

  const resolved = resolveCalloutContent(firstChild)
  if (!resolved) {
    return
  }

  const messages = createAimdRendererMessages(options.locale, options.messages)
  let titleChildren = resolved.titleChildren
  let bodyChildren: HastChild[] = resolved.bodyPrefixChildren.length > 0
    ? [{
        type: "element",
        tagName: "p",
        properties: {},
        children: resolved.bodyPrefixChildren,
      } as Element]
    : []
  let bodyStartIndex = firstContentIndex + 1

  const nextContentIndex = findMeaningfulChildIndex(element.children, bodyStartIndex)
  if (titleChildren.length === 0 && nextContentIndex >= 0 && isParagraph(element.children[nextContentIndex])) {
    titleChildren = trimTextEdges(element.children[nextContentIndex].children)
    bodyStartIndex = nextContentIndex + 1
  }

  const rootTagName = resolved.collapsible ? "details" : "blockquote"
  element.tagName = rootTagName
  element.properties = {
    ...element.properties,
    className: [
      ...classNames,
      "aimd-callout",
      `aimd-callout--${resolved.kind}`,
      ...(resolved.collapsible ? ["aimd-callout--collapsible"] : []),
    ],
    "data-aimd-callout": resolved.kind,
    "data-aimd-callout-icon": resolved.icon || resolved.kind,
    ...(resolved.collapsible ? { "data-aimd-callout-collapsible": "true" } : {}),
    ...(resolved.collapsible && !resolved.collapsed ? { open: true } : {}),
  }

  element.children = [
    createCalloutTitleElement(resolved, messages.callout[resolved.kind], titleChildren),
    createCalloutBodyElement([
      ...bodyChildren,
      ...toRenderableChildren(element.children.slice(bodyStartIndex)),
    ]),
  ]
}

export function transformCalloutBlockquotes(
  tree: HastRoot,
  options: AimdRendererOptions = {},
): void {
  const visit = (node: HastRoot | Element): void => {
    const children = "children" in node ? node.children : []
    for (const child of children) {
      if (child.type !== "element") {
        continue
      }

      transformBlockquoteToCallout(child, options)
      visit(child)
    }
  }

  visit(tree)
}
