<script lang="ts">
import { defineComponent, h, ref, watch, nextTick, onMounted, onBeforeUnmount, type PropType } from "vue"
import type { AimdVarTableNode } from "@airalogy/aimd-core/types"
import type { AimdFieldMeta, AimdFieldState } from "../types"
import type { AimdRecorderMessages } from "../locales"
import { getAimdRecorderScopeLabel } from "../locales"
import { getVarTableColumns, getVarTableRowKey } from "../composables/useVarTableDragDrop"

function renderTrashIcon() {
  return h("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.9",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }, [
    h("path", { d: "M3 6h18" }),
    h("path", { d: "M8 6V4.8c0-.7.6-1.3 1.3-1.3h5.4c.7 0 1.3.6 1.3 1.3V6" }),
    h("path", { d: "M18 6l-1 13.1c-.1.8-.7 1.4-1.5 1.4H8.5c-.8 0-1.4-.6-1.5-1.4L6 6" }),
    h("path", { d: "M10 10.5v6" }),
    h("path", { d: "M14 10.5v6" }),
  ])
}

function estimateDisplayWidth(value: unknown): number {
  const text = String(value ?? "")
  let width = 0
  for (const char of text) {
    width += (char.codePointAt(0) ?? 0) > 0xFF ? 2 : 1
  }
  return width
}

export default defineComponent({
  name: "AimdVarTableField",
  props: {
    node: { type: Object as PropType<AimdVarTableNode>, required: true },
    rows: { type: Array as PropType<Record<string, string>[]>, required: true },
    columns: { type: Array as PropType<string[]>, required: true },
    disabled: { type: Boolean, default: false },
    readonly: { type: Boolean, default: false },
    settlingRowKey: { type: String as PropType<string | null>, default: null },
    messages: { type: Object as PropType<AimdRecorderMessages>, required: true },
    fieldMeta: { type: Object as PropType<Record<string, AimdFieldMeta> | undefined>, default: undefined },
    fieldState: { type: Object as PropType<Record<string, AimdFieldState> | undefined>, default: undefined },
  },
  emits: [
    "cell-input",
    "cell-paste",
    "cell-blur",
    "add-row",
    "remove-row",
    "drag-start",
    "drag-over",
    "drag-drop",
    "drag-end",
  ],
  setup(props, { emit }) {
    const isOverflow = ref(false)
    const wrapperRef = ref<HTMLElement | null>(null)
    const tableRef = ref<HTMLElement | null>(null)
    let ro: ResizeObserver | null = null
    const OVERFLOW_HYSTERESIS_PX = 48
    let pendingOverflow: boolean | null = null
    let pendingOverflowFrames = 0

    let rafId: number | null = null

    function estimateColumnWidthCh(column: string, rows: Record<string, string>[]): number {
      const contentWidth = rows.reduce((maxWidth, row) => {
        return Math.max(maxWidth, estimateDisplayWidth(row[column]))
      }, estimateDisplayWidth(column))

      const normalizedColumn = column.toLowerCase()
      const isWideTextColumn
        = /note|remark|comment|description|summary|title|name/.test(normalizedColumn)
          || /备注|说明|描述|总结|标题|名称/.test(column)

      const minWidth = isWideTextColumn ? 18 : 10
      const maxWidth = isWideTextColumn ? 36 : 22
      return Math.max(minWidth, Math.min(maxWidth, contentWidth + 4))
    }

    function estimateTableWidthPx(columns: string[], rows: Record<string, string>[]): number {
      const CHARACTER_PX = 8.2
      const CELL_HORIZONTAL_PADDING_PX = 24
      const dragColumnPx = 24
      const actionColumnPx = 48

      const contentColumnsPx = columns.reduce((total, column) => {
        return total + estimateColumnWidthCh(column, rows) * CHARACTER_PX + CELL_HORIZONTAL_PADDING_PX
      }, 0)

      return dragColumnPx + actionColumnPx + contentColumnsPx
    }

    function checkOverflow() {
      if (!wrapperRef.value) return
      const wrapperWidth = wrapperRef.value.clientWidth
      const estimatedWidth = estimateTableWidthPx(props.columns, props.rows)
      const nextOverflow = isOverflow.value
        ? estimatedWidth > Math.max(0, wrapperWidth - OVERFLOW_HYSTERESIS_PX)
        : estimatedWidth > (wrapperWidth + OVERFLOW_HYSTERESIS_PX)

      if (nextOverflow === isOverflow.value) {
        pendingOverflow = null
        pendingOverflowFrames = 0
        return
      }

      if (pendingOverflow === nextOverflow) {
        pendingOverflowFrames += 1
      } else {
        pendingOverflow = nextOverflow
        pendingOverflowFrames = 1
      }

      if (pendingOverflowFrames >= 2) {
        isOverflow.value = nextOverflow
        pendingOverflow = null
        pendingOverflowFrames = 0
      }
    }

    function scheduleCheck() {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        rafId = null
        checkOverflow()
      })
    }

    onMounted(() => {
      if (!wrapperRef.value) return
      ro = new ResizeObserver(() => scheduleCheck())
      ro.observe(wrapperRef.value)
      nextTick(checkOverflow)
    })

    onBeforeUnmount(() => {
      ro?.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    })

    watch(() => props.columns, () => nextTick(scheduleCheck))
    watch(() => props.rows, () => nextTick(scheduleCheck), { deep: true })

    function isColumnDisabled(col: string): boolean {
      if (props.disabled) return true
      return !!(props.fieldMeta?.[`var_table:${props.node.id}:${col}`]?.disabled)
    }

    function estimateColumnWidth(column: string, rows: Record<string, string>[]): string {
      return `${estimateColumnWidthCh(column, rows)}ch`
    }

    function renderCardView(tableName: string, columns: string[], rows: Record<string, string>[], disabled: boolean, messages: AimdRecorderMessages) {
      return rows.map((row, rowIndex) => {
        const rowKey = getVarTableRowKey(row)
        const titleCol = columns[0]
        const restCols = columns.slice(1)
        return h("div", { key: `${tableName}-card-${rowKey}`, class: "aimd-rec-card" }, [
          h("div", { class: "aimd-rec-card__header" }, [
            h("div", { class: "aimd-rec-card__title" }, [
              h("span", { class: "aimd-rec-card__title-label" }, titleCol),
              h("input", {
                class: "aimd-rec-card__input aimd-rec-card__title-input",
                disabled: isColumnDisabled(titleCol),
                placeholder: titleCol,
                value: row[titleCol] ?? "",
                onInput: (e: Event) => emit("cell-input", { tableName, column: titleCol, rowIndex, value: (e.target as HTMLInputElement).value, row }),
                onBlur: () => emit("cell-blur", { tableName, column: titleCol }),
              }),
            ]),
            h("button", {
              type: "button",
              class: "aimd-rec-card__delete-btn",
              disabled: disabled || rows.length <= 1,
              "aria-label": messages.table.deleteRow,
              title: messages.table.deleteRow,
              onClick: () => emit("remove-row", { tableName, rowIndex, columns }),
            }, [renderTrashIcon()]),
          ]),
          h("div", { class: "aimd-rec-card__body" }, restCols.map(col => {
            const colState = props.fieldState?.[`var_table:${tableName}:${col}`]
            return h("div", { key: col, class: "aimd-rec-card__field" }, [
              h("span", { class: "aimd-rec-card__label" }, col),
              h("input", {
                class: colState?.validationError ? "aimd-rec-card__input aimd-rec-card__input--error" : "aimd-rec-card__input",
                disabled: isColumnDisabled(col),
                placeholder: col,
                value: row[col] ?? "",
                onInput: (e: Event) => emit("cell-input", { tableName, column: col, rowIndex, value: (e.target as HTMLInputElement).value, row }),
                onBlur: () => emit("cell-blur", { tableName, column: col }),
              }),
            ])
          })),
        ])
      })
    }

    return () => {
      const tableName = props.node.id
      const columns = props.columns
      const rows = props.rows
      const disabled = props.disabled
      const messages = props.messages

      return h("div", { ref: wrapperRef, class: "aimd-field aimd-field--var-table aimd-rec-inline-table" }, [
        h("div", { class: "aimd-field__header" }, [
          h("span", { class: "aimd-field__scope" }, getAimdRecorderScopeLabel("var_table", messages)),
          h("span", { class: "aimd-field__name" }, tableName),
        ]),
        isOverflow.value
          ? h("div", { class: "aimd-rec-card-list" }, [
              ...renderCardView(tableName, columns, rows, disabled, messages),
            ])
          : h("table", { ref: tableRef, class: "aimd-field__table-preview aimd-rec-inline-table__table" }, [
          h("colgroup", [
            h("col", { class: "aimd-rec-inline-table__drag-col" }),
            ...columns.map(column => h("col", {
              key: `${tableName}-col-${column}`,
              style: { width: estimateColumnWidth(column, rows) },
            })),
            h("col", { class: "aimd-rec-inline-table__action-col" }),
          ]),
          h("thead", [
            h("tr", [
              h("th", { class: "aimd-rec-inline-table__drag-head" }, ""),
              ...columns.map(column => h("th", column)),
              h("th", { class: "aimd-rec-inline-table__action-head" }, messages.table.actionColumn),
            ]),
          ]),
          h("tbody", rows.map((row, rowIndex) => {
            const rowKey = getVarTableRowKey(row)
            return h("tr", {
              key: `${tableName}-${rowKey}`,
              class: [
                "aimd-rec-inline-table__row",
                props.settlingRowKey === rowKey ? "aimd-rec-inline-table__row--settling" : "",
              ],
              onDragover: (event: DragEvent) => emit("drag-over", { tableName, rowIndex, event }),
              onDrop: (event: DragEvent) => emit("drag-drop", { tableName, rowIndex, columns, event }),
            }, [
              h("td", { class: "aimd-rec-inline-table__drag-cell" }, [
                h("span", {
                  class: [
                    "aimd-rec-inline-table__drag-handle",
                    props.readonly ? "aimd-rec-inline-table__drag-handle--disabled" : "",
                  ],
                  title: props.readonly ? messages.table.dragDisabled : messages.table.dragReorder,
                  draggable: !props.readonly,
                  onDragstart: (event: DragEvent) => emit("drag-start", { tableName, rowIndex, event }),
                  onDragend: () => emit("drag-end"),
                }, Array.from({ length: 6 }, (_, dotIndex) => h("span", {
                  key: `${rowKey}-drag-dot-${dotIndex}`,
                  class: "aimd-rec-inline-table__drag-dot",
                }))),
              ]),
              ...columns.map(column => h("td", { key: `${tableName}-${rowIndex}-${column}` }, [
                (() => {
                  const colState = props.fieldState?.[`var_table:${tableName}:${column}`]
                  const cellClass = colState?.validationError
                    ? "aimd-rec-table-cell-input aimd-rec-table-cell-input--error"
                    : "aimd-rec-table-cell-input"
                  return h("input", {
                    "data-rec-focus-key": `var_table:${tableName}:${rowIndex}:${column}`,
                    class: cellClass,
                    disabled: isColumnDisabled(column),
                    placeholder: column,
                    value: row[column] ?? "",
                    onInput: (event: Event) => {
                      emit("cell-input", {
                        tableName,
                        column,
                        rowIndex,
                        value: (event.target as HTMLInputElement).value,
                        row,
                      })
                    },
                    onPaste: (event: ClipboardEvent) => {
                      const text = event.clipboardData?.getData("text/plain") ?? ""
                      if (!text || (!text.includes("\t") && !/[\r\n]/.test(text))) {
                        return
                      }
                      event.preventDefault()
                      emit("cell-paste", {
                        tableName,
                        column,
                        rowIndex,
                        text,
                      })
                    },
                    onBlur: () => emit("cell-blur", { tableName, column }),
                  })
                })(),
              ])),
              h("td", { class: "aimd-rec-inline-table__action-cell" }, [
                h("button", {
                  type: "button",
                  class: "aimd-rec-inline-table__icon-btn",
                  disabled: disabled || rows.length <= 1,
                  "aria-label": messages.table.deleteRow,
                  title: messages.table.deleteRow,
                  onClick: () => emit("remove-row", { tableName, rowIndex, columns }),
                }, [renderTrashIcon()]),
              ]),
            ])
          })),
        ]),
        h("div", { class: "aimd-rec-inline-table__actions" }, [
          h("button", {
            type: "button",
            class: "aimd-rec-inline-table__add-btn",
            disabled,
            onClick: () => emit("add-row", { tableName, columns }),
          }, `+ ${messages.table.addRow}`),
        ]),
      ])
    }
  },
})
</script>
