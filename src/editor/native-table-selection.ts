import type { TableCellCoordinate } from "./table-selection";

export interface NativeTableDomSelection {
  coordinates: TableCellCoordinate[];
  tableElement: HTMLTableElement;
  widget: HTMLElement;
}

function asElement(target: EventTarget | null): Element | null {
  return target !== null && "closest" in target ? target as Element : null;
}

function cellCoordinate(table: HTMLTableElement, cell: HTMLTableCellElement): TableCellCoordinate | null {
  const rows = Array.from(table.rows);
  const row = rows.indexOf(cell.parentElement as HTMLTableRowElement);
  if (row < 0) return null;
  const column = Array.from(rows[row]?.cells ?? []).indexOf(cell);
  return column < 0 ? null : { row, column };
}

export function nativeTableDomSelection(event: MouseEvent): NativeTableDomSelection | null {
  const target = asElement(event.target);
  if (target === null) return null;
  const widget = target.closest<HTMLElement>(".cm-table-widget");
  if (widget === null) return null;
  const tableElement = widget.querySelector<HTMLTableElement>("table");
  if (tableElement === null) return null;
  const targetCell = target.closest<HTMLTableCellElement>("th, td");
  let cells = Array.from(tableElement.querySelectorAll<HTMLTableCellElement>("th.is-selected, td.is-selected"));
  if (targetCell !== null && !cells.includes(targetCell)) cells = [targetCell];
  if (cells.length === 0) return null;
  const coordinates = cells.map((cell) => cellCoordinate(tableElement, cell));
  if (coordinates.some((coordinate) => coordinate === null)) return null;
  return {
    coordinates: coordinates as TableCellCoordinate[],
    tableElement,
    widget,
  };
}
