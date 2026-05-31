import { describe, it, expect } from 'vitest';
import {
    columnLabel,
    createEmptySheet,
    isSheetEmpty,
    parseDelimitedText,
    htmlToSheet,
    clipboardToSheet,
    normalizeSheet,
    writeBlock,
    sheetToRecords,
    type SheetGrid,
} from '../../../../src/data/sheet';

// Helper: turn a grid of strings into a SheetGrid for terse fixtures.
const grid = (rows: string[][]): SheetGrid => rows.map((r) => r.map((value) => ({ value })));

// Helper: extract just the values from a SheetGrid for terse assertions.
const values = (g: SheetGrid): string[][] => g.map((r) => r.map((c) => c.value));

describe('columnLabel', () => {
    it('should label the first column A', () => {
        expect(columnLabel(0)).toBe('A');
    });

    it('should label the 26th column Z', () => {
        expect(columnLabel(25)).toBe('Z');
    });

    it('should roll over to AA after Z', () => {
        expect(columnLabel(26)).toBe('AA');
    });

    it('should label column 27 AB', () => {
        expect(columnLabel(27)).toBe('AB');
    });
});

describe('createEmptySheet', () => {
    it('should build a grid with the requested dimensions', () => {
        const sheet = createEmptySheet(3, 2);
        expect(sheet.length).toBe(3);
        expect(sheet[0].length).toBe(2);
    });

    it('should fill every cell with an empty value', () => {
        const sheet = createEmptySheet(2, 2);
        expect(isSheetEmpty(sheet)).toBe(true);
    });
});

describe('isSheetEmpty', () => {
    it('should return true for a blank grid', () => {
        expect(isSheetEmpty(grid([['', ''], ['', '']]))).toBe(true);
    });

    it('should return true when cells contain only whitespace', () => {
        expect(isSheetEmpty(grid([[' ', '\t']]))).toBe(true);
    });

    it('should return false when any cell has text', () => {
        expect(isSheetEmpty(grid([['', 'x']]))).toBe(false);
    });
});

describe('parseDelimitedText', () => {
    // --- Empty input ---
    it('should return [] for empty string', () => {
        expect(parseDelimitedText('')).toEqual([]);
    });

    it('should return [] for whitespace-only input', () => {
        expect(parseDelimitedText('   \n  ')).toEqual([]);
    });

    // --- Tab separated (Excel clipboard) ---
    it('should parse tab-separated rows', () => {
        const text = 'a\tb\tc\n1\t2\t3';
        expect(parseDelimitedText(text)).toEqual([
            ['a', 'b', 'c'],
            ['1', '2', '3'],
        ]);
    });

    it('should keep empty cells between tabs', () => {
        const text = 'a\t\tc';
        expect(parseDelimitedText(text)).toEqual([['a', '', 'c']]);
    });

    // --- Comma separated ---
    it('should parse comma-separated rows', () => {
        const text = 'name,age\nAlice,30';
        expect(parseDelimitedText(text)).toEqual([
            ['name', 'age'],
            ['Alice', '30'],
        ]);
    });

    it('should respect quoted commas in CSV', () => {
        const text = 'city,note\n"Paris, FR",ok';
        expect(parseDelimitedText(text)).toEqual([
            ['city', 'note'],
            ['Paris, FR', 'ok'],
        ]);
    });

    // --- Line endings ---
    it('should normalise CRLF line endings', () => {
        const text = 'a\tb\r\n1\t2\r\n';
        expect(parseDelimitedText(text)).toEqual([
            ['a', 'b'],
            ['1', '2'],
        ]);
    });

    it('should not emit a trailing empty row for a trailing newline', () => {
        const text = 'a\tb\n1\t2\n';
        expect(parseDelimitedText(text).length).toBe(2);
    });
});

describe('htmlToSheet', () => {
    it('should return null when there is no table', () => {
        expect(htmlToSheet('<div>no table here</div>')).toBeNull();
    });

    it('should parse a simple HTML table into cell values', () => {
        const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>';
        const sheet = htmlToSheet(html);
        expect(sheet).not.toBeNull();
        expect(values(sheet as SheetGrid)).toEqual([
            ['a', 'b'],
            ['1', '2'],
        ]);
    });

    it('should expand colspan into blank trailing cells', () => {
        const html = '<table><tr><td colspan="2">merged</td><td>x</td></tr></table>';
        const sheet = htmlToSheet(html) as SheetGrid;
        expect(values(sheet)).toEqual([['merged', '', 'x']]);
    });

    it('should collapse non-breaking spaces and internal newlines', () => {
        const html = '<table><tr><td>a&nbsp;b\nc</td></tr></table>';
        const sheet = htmlToSheet(html) as SheetGrid;
        expect(sheet[0][0].value).toBe('a b c');
    });

    // --- Style preservation: inline (Google Sheets / Mac Excel style) ---
    it('should capture inline background and bold styling', () => {
        const html =
            '<table><tr><td style="background-color:#ffff00;font-weight:bold">hi</td></tr></table>';
        const sheet = htmlToSheet(html) as SheetGrid;
        expect(sheet[0][0].style?.backgroundColor).toBe('#ffff00');
        expect(sheet[0][0].style?.fontWeight).toBe('bold');
    });

    it('should capture italic, underline and alignment', () => {
        const html =
            '<table><tr><td style="font-style:italic;text-decoration:underline;text-align:right">x</td></tr></table>';
        const style = (htmlToSheet(html) as SheetGrid)[0][0].style;
        expect(style?.fontStyle).toBe('italic');
        expect(style?.textDecoration).toBe('underline');
        expect(style?.textAlign).toBe('right');
    });

    it('should ignore transparent backgrounds', () => {
        const html = '<table><tr><td style="background-color:transparent">x</td></tr></table>';
        const style = (htmlToSheet(html) as SheetGrid)[0][0].style;
        expect(style?.backgroundColor).toBeUndefined();
    });

    // --- Style preservation: class-based (Windows Excel style) ---
    it('should resolve class-based styles from a <style> block', () => {
        const html =
            '<html><head><style>.xl63 { background:#00ff00; color:#111111; }</style></head>' +
            '<body><table><tr><td class="xl63">v</td></tr></table></body></html>';
        const sheet = htmlToSheet(html) as SheetGrid;
        expect(sheet[0][0].style?.backgroundColor).toBe('#00ff00');
        expect(sheet[0][0].style?.color).toBe('#111111');
    });

    it('should let inline styles override class styles', () => {
        const html =
            '<style>.x { background:#000000; }</style>' +
            '<table><tr><td class="x" style="background:#ffffff">v</td></tr></table>';
        const sheet = htmlToSheet(html) as SheetGrid;
        expect(sheet[0][0].style?.backgroundColor).toBe('#ffffff');
    });

    it('should treat numeric font-weight >= 600 as bold', () => {
        const html = '<table><tr><td style="font-weight:700">v</td></tr></table>';
        expect((htmlToSheet(html) as SheetGrid)[0][0].style?.fontWeight).toBe('bold');
    });
});

describe('clipboardToSheet', () => {
    it('should prefer the HTML table when present', () => {
        const html = '<table><tr><td>html</td></tr></table>';
        const text = 'plain';
        expect(values(clipboardToSheet(html, text))).toEqual([['html']]);
    });

    it('should fall back to delimited text without an HTML table', () => {
        expect(values(clipboardToSheet('<div>no table</div>', 'a\tb'))).toEqual([['a', 'b']]);
    });

    it('should use plain text when html is null', () => {
        expect(values(clipboardToSheet(null, 'x,y'))).toEqual([['x', 'y']]);
    });

    it('should return [] when both payloads are empty', () => {
        expect(clipboardToSheet(null, '')).toEqual([]);
    });
});

describe('normalizeSheet', () => {
    it('should pad ragged rows to a uniform width', () => {
        const result = normalizeSheet(grid([['a', 'b'], ['c']]));
        expect(values(result)).toEqual([
            ['a', 'b'],
            ['c', ''],
        ]);
    });

    it('should trim trailing blank rows', () => {
        const result = normalizeSheet(grid([['a'], [''], ['']]));
        expect(result.length).toBe(1);
    });

    it('should trim trailing blank columns', () => {
        const result = normalizeSheet(grid([['a', '', ''], ['b', '', '']]));
        expect(values(result)).toEqual([['a'], ['b']]);
    });

    it('should keep interior blank cells', () => {
        const result = normalizeSheet(grid([['a', '', 'c']]));
        expect(values(result)).toEqual([['a', '', 'c']]);
    });

    it('should return [] for an all-blank grid', () => {
        expect(normalizeSheet(grid([['', ''], ['', '']]))).toEqual([]);
    });
});

describe('writeBlock', () => {
    it('should overlay a block at the origin', () => {
        const base = createEmptySheet(2, 2);
        const block = grid([['1', '2']]);
        expect(values(writeBlock(base, block, 0, 0))).toEqual([
            ['1', '2'],
            ['', ''],
        ]);
    });

    it('should overlay a block at an offset', () => {
        const base = createEmptySheet(2, 2);
        const block = grid([['x']]);
        expect(values(writeBlock(base, block, 1, 1))).toEqual([
            ['', ''],
            ['', 'x'],
        ]);
    });

    it('should grow the base grid when the block overflows', () => {
        const base = createEmptySheet(1, 1);
        const block = grid([['a', 'b'], ['c', 'd']]);
        const result = writeBlock(base, block, 0, 0);
        expect(result.length).toBe(2);
        expect(result[0].length).toBe(2);
        expect(values(result)).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ]);
    });

    it('should preserve existing cells outside the block', () => {
        const base = grid([['keep', 'keep2']]);
        const block = grid([['new']]);
        expect(values(writeBlock(base, block, 0, 1))).toEqual([['keep', 'new']]);
    });
});

describe('sheetToRecords', () => {
    it('should use the first row as headers when firstRowHeader is true', () => {
        const sheet = grid([
            ['name', 'age'],
            ['Alice', '30'],
            ['Bob', '25'],
        ]);
        expect(sheetToRecords(sheet, true)).toEqual([
            { name: 'Alice', age: '30' },
            { name: 'Bob', age: '25' },
        ]);
    });

    it('should synthesise Column{n} headers when firstRowHeader is false', () => {
        const sheet = grid([['Alice', '30']]);
        expect(sheetToRecords(sheet, false)).toEqual([{ Column1: 'Alice', Column2: '30' }]);
    });

    it('should replace blank header cells with Column{n}', () => {
        const sheet = grid([
            ['name', ''],
            ['Alice', '30'],
        ]);
        expect(sheetToRecords(sheet, true)).toEqual([{ name: 'Alice', Column2: '30' }]);
    });

    it('should de-duplicate repeated header names', () => {
        const sheet = grid([
            ['id', 'id'],
            ['1', '2'],
        ]);
        expect(sheetToRecords(sheet, true)).toEqual([{ id: '1', id_1: '2' }]);
    });

    it('should return [] for an empty sheet', () => {
        expect(sheetToRecords(createEmptySheet(3, 3), true)).toEqual([]);
    });

    it('should return [] when a header-only sheet has no data rows', () => {
        const sheet = grid([['a', 'b']]);
        expect(sheetToRecords(sheet, true)).toEqual([]);
    });
});
