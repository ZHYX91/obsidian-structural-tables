export type CellRole = "corner_header" | "column_header" | "row_header" | "data";
export type MergeMarker = "left" | "up";
export type ColumnAlignment = "default" | "left" | "center" | "right";

export interface SourceRange {
  from: number;
  to: number;
}

export interface TableDiagnostic {
  code:
    | "boundary-at-edge"
    | "boundary-count"
    | "boundary-token"
    | "merge-boundary"
    | "merge-missing-anchor"
    | "merge-nonrectangular"
    | "row-width";
  message: string;
  row: number;
  column?: number;
}

export interface StructuralCell {
  row: number;
  column: number;
  raw: string;
  content: string;
  role: CellRole;
  marker?: MergeMarker;
  anchorRow: number;
  anchorColumn: number;
  rowSpan: number;
  columnSpan: number;
  covered: boolean;
}

export interface StructuralRow {
  sourceLine: number;
  cells: StructuralCell[];
}

export interface StructuralTable {
  range: SourceRange;
  startLine: number;
  endLine: number;
  delimiterLine: number;
  columnCount: number;
  headerRowCount: number;
  rowHeaderColumnCount: number;
  alignments: ColumnAlignment[];
  rows: StructuralRow[];
  diagnostics: TableDiagnostic[];
  structural: boolean;
  valid: boolean;
  source: string;
}

export interface ParseResult {
  tables: StructuralTable[];
}
