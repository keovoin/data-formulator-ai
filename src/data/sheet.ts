// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as d3 from 'd3';

/**
 * Sheet utilities — pure, framework-free helpers that power the in-app
 * editable data sheet (see `src/views/EditableDataSheet.tsx`).
 *
 * The sheet lets users type data by hand or paste a range copied from
 * Excel / Google Sheets / any delimited text, without uploading a file.
 * When the clipboard carries an HTML table (the rich form Excel and
 * Google Sheets put there alongside the plain-text TSV), we preserve a
 * small set of visual styles (fill, text color, bold/italic/underline,
 * alignment) so the sheet mirrors what the user copied.
 *
 * Everything here is deliberately side-effect free so it can be unit
 * tested without rendering React. The only browser API touched is
 * `DOMParser`, which is available both in the app and in the jsdom test
 * environment.
 */

/** Subset of cell visual styles we carry over from a pasted HTML table. */
export interface SheetCellStyle {
    backgroundColor?: string;
    color?: string;
    fontWeight?: string;
    fontStyle?: string;
    textAlign?: string;
    textDecoration?: string;
}

/** A single sheet cell: its text value plus optional display styling. */
export interface SheetCell {
    value: string;
    style?: SheetCellStyle;
}

/** A sheet is a dense 2D grid of cells (row-major). */
export type SheetGrid = SheetCell[][];

/** Build a cell, omitting an empty style object so equality stays simple. */
const makeCell = (value: string, style?: SheetCellStyle): SheetCell =>
    style && Object.keys(style).length > 0 ? { value, style } : { value };

/** Clone a cell (shallow style copy) so callers never alias shared objects. */
const cloneCell = (cell: SheetCell | undefined): SheetCell =>
    cell ? { value: cell.value, ...(cell.style ? { style: { ...cell.style } } : {}) } : { value: '' };

/** Create an empty `rows` x `cols` grid of blank cells. */
export const createEmptySheet = (rows: number, cols: number): SheetGrid =>
    Array.from({ length: Math.max(0, rows) }, () =>
        Array.from({ length: Math.max(0, cols) }, () => ({ value: '' as string }))
    );

/** True when no cell in the grid holds non-whitespace text. */
export const isSheetEmpty = (grid: SheetGrid): boolean =>
    !grid.some((row) => row.some((cell) => (cell.value ?? '').trim() !== ''));

/**
 * Spreadsheet-style column label for a zero-based index:
 * 0 -> "A", 25 -> "Z", 26 -> "AA", 27 -> "AB", ...
 */
export const columnLabel = (index: number): string => {
    let label = '';
    let n = index;
    do {
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
};

// ── Delimited text (TSV / CSV) ──────────────────────────────────────────

/**
 * Parse delimited text into a 2D array of string cells.
 *
 * Tab-separated input (what Excel/Sheets place in the plain-text clipboard
 * slot) is detected by counting tabs per line; otherwise the text is parsed
 * as CSV with proper quote handling. Returns `[]` for empty input.
 */
export const parseDelimitedText = (text: string): string[][] => {
    if (!text) return [];
    // Normalise line endings and drop a single trailing newline so we don't
    // synthesise a spurious empty trailing row.
    const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n$/, '');
    if (normalised.trim() === '') return [];

    let tabNum = 0;
    let lineNum = 0;
    for (let i = 0; i < normalised.length; i++) {
        const ch = normalised.charAt(i);
        if (ch === '\t') tabNum++;
        if (ch === '\n') lineNum++;
    }

    // One-or-more tab per line => tab separated. For single-line input fall
    // back to "does it contain a tab at all".
    const isTabSeparated = lineNum === 0 ? normalised.includes('\t') : tabNum / lineNum >= 1;

    const rows = isTabSeparated
        ? d3.tsvParseRows(normalised)
        : d3.dsvFormat(',').parseRows(normalised);

    // d3 returns (string | undefined)[] rows; coerce gaps to ''.
    return rows.map((row) => row.map((v) => (v == null ? '' : v)));
};

// ── HTML table (rich paste) ─────────────────────────────────────────────

/** Parse a `prop: value; prop2: value2` declaration block into a map. */
const parseDeclarations = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const decl of text.split(';')) {
        const idx = decl.indexOf(':');
        if (idx === -1) continue;
        const prop = decl.slice(0, idx).trim().toLowerCase();
        const value = decl.slice(idx + 1).trim();
        if (prop) out[prop] = value;
    }
    return out;
};

/**
 * Build a `className -> declarations` map from any `<style>` blocks in the
 * document. Excel-on-Windows styles its copied table via classes (`.xl63`)
 * defined in a leading `<style>` element rather than inline attributes, so
 * resolving them is what preserves fills/fonts for that source.
 */
const buildClassStyleMap = (doc: Document): Record<string, Record<string, string>> => {
    const map: Record<string, Record<string, string>> = {};
    const styleText = Array.from(doc.querySelectorAll('style'))
        .map((el) => el.textContent || '')
        .join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments

    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = ruleRe.exec(styleText)) !== null) {
        const selectors = match[1].split(',');
        const decls = parseDeclarations(match[2]);
        if (Object.keys(decls).length === 0) continue;
        for (const selector of selectors) {
            const classMatch = selector.trim().match(/\.([\w-]+)/);
            if (classMatch) {
                const cls = classMatch[1];
                map[cls] = { ...(map[cls] || {}), ...decls };
            }
        }
    }
    return map;
};

const COLOR_RE = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[a-zA-Z]+)/;

const extractColor = (raw: string): string | undefined => {
    const m = raw.match(COLOR_RE);
    return m ? m[1] : undefined;
};

const isTransparentColor = (color: string): boolean => {
    const c = color.trim().toLowerCase();
    if (c === 'transparent' || c === 'none' || c === 'inherit' || c === 'initial') return true;
    // rgba(...,0) fully transparent
    const rgbaMatch = c.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
    if (rgbaMatch && parseFloat(rgbaMatch[1]) === 0) return true;
    return false;
};

/** Map a CSS declaration block to the small style subset the sheet keeps. */
const pickSheetStyle = (decls: Record<string, string>): SheetCellStyle | undefined => {
    const style: SheetCellStyle = {};

    const bgRaw = decls['background-color'] || decls['background'];
    if (bgRaw) {
        const color = extractColor(bgRaw);
        if (color && !isTransparentColor(color)) style.backgroundColor = color;
    }

    const color = decls['color'];
    if (color && !isTransparentColor(color)) style.color = color;

    const fontWeight = decls['font-weight'];
    if (fontWeight) {
        const numeric = parseInt(fontWeight, 10);
        if (fontWeight === 'bold' || fontWeight === 'bolder' || (!isNaN(numeric) && numeric >= 600)) {
            style.fontWeight = 'bold';
        }
    }

    if (decls['font-style'] === 'italic') style.fontStyle = 'italic';

    const textAlign = decls['text-align'];
    if (textAlign && ['left', 'right', 'center', 'justify'].includes(textAlign)) {
        style.textAlign = textAlign;
    }

    const textDecoration = decls['text-decoration'] || decls['text-decoration-line'];
    if (textDecoration && textDecoration.includes('underline')) style.textDecoration = 'underline';

    return Object.keys(style).length > 0 ? style : undefined;
};

/** Collapse a cell's text: drop NBSPs and turn internal newlines into spaces. */
const normaliseCellText = (text: string): string =>
    text.replace(/\u00a0/g, ' ').replace(/[ \t]*\n[ \t]*/g, ' ').trim();

/**
 * Convert the first `<table>` in an HTML fragment to a sheet grid, carrying
 * over per-cell styling. Returns `null` when the fragment has no table (so
 * callers can fall back to plain-text parsing).
 */
export const htmlToSheet = (html: string): SheetGrid | null => {
    if (!html || typeof DOMParser === 'undefined') return null;

    let doc: Document;
    try {
        doc = new DOMParser().parseFromString(html, 'text/html');
    } catch {
        return null;
    }

    const table = doc.querySelector('table');
    if (!table) return null;

    const classMap = buildClassStyleMap(doc);
    const grid: SheetGrid = [];

    const rows = Array.from(table.querySelectorAll('tr'));
    for (const tr of rows) {
        const cells = Array.from(tr.children).filter(
            (el) => el.tagName === 'TD' || el.tagName === 'TH'
        ) as HTMLElement[];
        if (cells.length === 0) continue;

        const rowCells: SheetCell[] = [];
        for (const td of cells) {
            const value = normaliseCellText(td.textContent ?? '');

            const decls: Record<string, string> = {};
            const className = td.getAttribute('class');
            if (className) {
                for (const cls of className.split(/\s+/)) {
                    if (classMap[cls]) Object.assign(decls, classMap[cls]);
                }
            }
            const inline = td.getAttribute('style');
            if (inline) Object.assign(decls, parseDeclarations(inline));

            const style = pickSheetStyle(decls);

            const span = Math.max(1, parseInt(td.getAttribute('colspan') || '1', 10) || 1);
            rowCells.push(makeCell(value, style));
            for (let s = 1; s < span; s++) rowCells.push(makeCell(''));
        }
        grid.push(rowCells);
    }

    return grid.length > 0 ? grid : null;
};

/**
 * Turn clipboard payloads into a sheet grid. Prefers the HTML table (rich,
 * style-preserving) and falls back to delimited plain text. Always returns a
 * normalised grid (padded + trailing blanks trimmed).
 */
export const clipboardToSheet = (html: string | null, text: string | null): SheetGrid => {
    const fromHtml = html ? htmlToSheet(html) : null;
    if (fromHtml && fromHtml.length > 0) return normalizeSheet(fromHtml);

    const rows = text ? parseDelimitedText(text) : [];
    return normalizeSheet(rows.map((row) => row.map((v) => ({ value: v }))));
};

// ── Grid shape helpers ──────────────────────────────────────────────────

const maxColumnCount = (grid: SheetGrid): number =>
    grid.reduce((max, row) => Math.max(max, row.length), 0);

const isBlankRow = (row: SheetCell[]): boolean => row.every((c) => (c.value ?? '').trim() === '');

/**
 * Pad every row to a uniform width and trim trailing all-blank rows and
 * columns. Keeps interior blanks (which may be meaningful gaps).
 */
export const normalizeSheet = (grid: SheetGrid): SheetGrid => {
    if (grid.length === 0) return [];

    const cols = maxColumnCount(grid);
    if (cols === 0) return [];

    let padded: SheetGrid = grid.map((row) => {
        const copy = row.map(cloneCell);
        while (copy.length < cols) copy.push({ value: '' });
        return copy;
    });

    // Trim trailing blank rows.
    while (padded.length > 0 && isBlankRow(padded[padded.length - 1])) padded.pop();
    if (padded.length === 0) return [];

    // Trim trailing blank columns.
    let lastCol = cols - 1;
    const columnBlank = (c: number) => padded.every((row) => (row[c]?.value ?? '').trim() === '');
    while (lastCol >= 0 && columnBlank(lastCol)) lastCol--;
    if (lastCol < 0) return [];

    return padded.map((row) => row.slice(0, lastCol + 1));
};

/**
 * Overlay `block` onto `base` starting at (`startRow`, `startCol`), growing
 * `base` as needed. Used when pasting a copied range into an existing sheet
 * at the focused cell. Neither input is mutated.
 */
export const writeBlock = (
    base: SheetGrid,
    block: SheetGrid,
    startRow: number,
    startCol: number
): SheetGrid => {
    const r0 = Math.max(0, startRow);
    const c0 = Math.max(0, startCol);
    const blockCols = maxColumnCount(block);

    const totalRows = Math.max(base.length, r0 + block.length);
    const totalCols = Math.max(maxColumnCount(base), c0 + blockCols);

    const result: SheetGrid = [];
    for (let r = 0; r < totalRows; r++) {
        const row: SheetCell[] = [];
        for (let c = 0; c < totalCols; c++) {
            const blockRow = r - r0;
            const blockCol = c - c0;
            const inBlock =
                blockRow >= 0 &&
                blockRow < block.length &&
                blockCol >= 0 &&
                blockCol < block[blockRow].length;
            row.push(inBlock ? cloneCell(block[blockRow][blockCol]) : cloneCell(base[r]?.[c]));
        }
        result.push(row);
    }
    return result;
};

// ── Sheet -> records (for table creation) ───────────────────────────────

/** De-duplicate header names by appending `_1`, `_2`, ... to collisions. */
const dedupeHeaders = (raw: string[]): string[] => {
    const out: string[] = [];
    for (const name of raw) {
        if (out.includes(name)) {
            let k = 1;
            while (out.includes(`${name}_${k}`)) k++;
            out.push(`${name}_${k}`);
        } else {
            out.push(name);
        }
    }
    return out;
};

/**
 * Convert a sheet grid into an array of plain record objects suitable for
 * `createTableFromFromObjectArray`. When `firstRowHeader` is true the first
 * row supplies column names (blanks become `Column{n}`); otherwise synthetic
 * `Column{n}` names are used and all rows are treated as data.
 */
export const sheetToRecords = (
    grid: SheetGrid,
    firstRowHeader: boolean
): Record<string, string>[] => {
    const clean = normalizeSheet(grid);
    if (clean.length === 0) return [];

    const numCols = maxColumnCount(clean);

    const rawHeaders = Array.from({ length: numCols }, (_, i) => {
        if (firstRowHeader) {
            const v = (clean[0][i]?.value ?? '').trim();
            return v === '' ? `Column${i + 1}` : v;
        }
        return `Column${i + 1}`;
    });
    const headers = dedupeHeaders(rawHeaders);

    const dataRows = firstRowHeader ? clean.slice(1) : clean;
    return dataRows.map((row) => {
        const record: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
            record[headers[i]] = row[i]?.value ?? '';
        }
        return record;
    });
};
