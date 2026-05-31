// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import {
    Box,
    Button,
    FormControlLabel,
    IconButton,
    Switch,
    Tooltip,
    Typography,
    alpha,
    useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useTranslation } from 'react-i18next';

import { borderColor, radius } from '../app/tokens';
import {
    SheetCell,
    SheetGrid,
    clipboardToSheet,
    columnLabel,
    createEmptySheet,
    isSheetEmpty,
    normalizeSheet,
    writeBlock,
} from '../data/sheet';

// Past these sizes we stop rendering live <input> cells (a paste of tens of
// thousands of cells would otherwise lock the tab). The full grid is still
// kept in state and imported in full — only the editable preview is capped.
const MAX_RENDER_ROWS = 200;
const MAX_RENDER_COLS = 50;

export interface EditableDataSheetProps {
    /** The full grid (controlled). */
    cells: SheetGrid;
    /** Called with the next grid whenever the user edits, pastes, or resizes. */
    onChange: (cells: SheetGrid) => void;
    /** Whether the first row is treated as column headers on import. */
    firstRowHeader: boolean;
    onFirstRowHeaderChange: (value: boolean) => void;
}

/**
 * A lightweight, spreadsheet-style editor. Users can type cell-by-cell or
 * paste a range copied from Excel / Google Sheets / any delimited text.
 * Pasting fills cells from the focused cell outward, growing the grid as
 * needed, and preserves a small set of visual styles (fill, font, alignment)
 * when the clipboard carries a rich HTML table.
 *
 * The component is fully controlled; all grid transforms live in
 * `src/data/sheet.ts` so they stay unit-testable.
 */
export const EditableDataSheet: React.FC<EditableDataSheetProps> = ({
    cells,
    onChange,
    firstRowHeader,
    onFirstRowHeaderChange,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState<[number, number]>([0, 0]);

    const numRows = cells.length;
    const numCols = cells.reduce((max, row) => Math.max(max, row.length), 0);

    const renderRowCount = Math.min(numRows, MAX_RENDER_ROWS);
    const renderColCount = Math.min(numCols, MAX_RENDER_COLS);
    const hasHiddenRows = numRows > renderRowCount;
    const hasHiddenCols = numCols > renderColCount;

    // ── Cell edits ──────────────────────────────────────────────────────
    const updateCell = useCallback(
        (r: number, c: number, value: string) => {
            const next = cells.map((row, ri) =>
                ri === r ? row.map((cell, ci) => (ci === c ? { ...cell, value } : cell)) : row
            );
            onChange(next);
        },
        [cells, onChange]
    );

    const focusCell = useCallback((r: number, c: number) => {
        const node = containerRef.current?.querySelector<HTMLInputElement>(
            `input[data-row="${r}"][data-col="${c}"]`
        );
        if (node) {
            node.focus();
            node.select();
        }
    }, []);

    // ── Structure edits ─────────────────────────────────────────────────
    const addRow = useCallback(() => {
        const width = Math.max(1, numCols);
        onChange([...cells, Array.from({ length: width }, () => ({ value: '' as string }))]);
    }, [cells, numCols, onChange]);

    const addColumn = useCallback(() => {
        const base = numRows > 0 ? cells : createEmptySheet(1, 0);
        onChange(base.map((row) => [...row, { value: '' as string }]));
    }, [cells, numRows, onChange]);

    const deleteRow = useCallback(
        (r: number) => {
            if (numRows <= 1) {
                onChange(createEmptySheet(1, Math.max(1, numCols)));
                return;
            }
            onChange(cells.filter((_, ri) => ri !== r));
        },
        [cells, numRows, numCols, onChange]
    );

    const deleteColumn = useCallback(
        (c: number) => {
            if (numCols <= 1) {
                onChange(createEmptySheet(Math.max(1, numRows), 1));
                return;
            }
            onChange(cells.map((row) => row.filter((_, ci) => ci !== c)));
        },
        [cells, numRows, numCols, onChange]
    );

    const clearSheet = useCallback(() => {
        onChange(createEmptySheet(Math.max(8, 0), Math.max(4, 0)));
        setActive([0, 0]);
    }, [onChange]);

    // ── Clipboard paste ─────────────────────────────────────────────────
    const handlePaste = useCallback(
        (event: React.ClipboardEvent<HTMLDivElement>) => {
            const html = event.clipboardData.getData('text/html');
            const text = event.clipboardData.getData('text/plain');
            const block = clipboardToSheet(html || null, text || null);
            if (block.length === 0) return; // nothing tabular — let default paste run

            event.preventDefault();
            // Pasting into a blank sheet replaces it wholesale (clean import);
            // pasting into a populated sheet overlays at the focused cell.
            const next = isSheetEmpty(cells)
                ? normalizeSheet(block)
                : writeBlock(cells, block, active[0], active[1]);
            onChange(next);
        },
        [active, cells, onChange]
    );

    // ── Keyboard navigation ─────────────────────────────────────────────
    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (r + 1 < renderRowCount) {
                    focusCell(r + 1, c);
                } else {
                    addRow();
                    // Defer focus until the new row has rendered.
                    setTimeout(() => focusCell(r + 1, c), 0);
                }
            } else if (event.key === 'ArrowDown' && r + 1 < renderRowCount) {
                event.preventDefault();
                focusCell(r + 1, c);
            } else if (event.key === 'ArrowUp' && r > 0) {
                event.preventDefault();
                focusCell(r - 1, c);
            }
        },
        [addRow, focusCell, renderRowCount]
    );

    const headerCellSx = {
        backgroundColor: alpha(theme.palette.primary.main, 0.06),
        borderBottom: `2px solid ${alpha(theme.palette.primary.main, 0.25)}`,
    };

    const cellStyleToCss = (cell: SheetCell): React.CSSProperties => ({
        backgroundColor: cell.style?.backgroundColor ?? 'transparent',
        color: cell.style?.color ?? 'inherit',
        fontWeight: cell.style?.fontWeight ?? 'normal',
        fontStyle: cell.style?.fontStyle ?? 'normal',
        textDecoration: cell.style?.textDecoration ?? 'none',
        textAlign: (cell.style?.textAlign as React.CSSProperties['textAlign']) ?? 'left',
    });

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 1 }}>
            {/* Toolbar */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1,
                }}
            >
                <FormControlLabel
                    control={
                        <Switch
                            size="small"
                            checked={firstRowHeader}
                            onChange={(e) => onFirstRowHeaderChange(e.target.checked)}
                        />
                    }
                    label={
                        <Typography variant="body2">
                            {t('upload.sheet.firstRowHeader', { defaultValue: 'First row is header' })}
                        </Typography>
                    }
                />
                <Box sx={{ flex: 1 }} />
                <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={addRow}
                    sx={{ textTransform: 'none' }}
                >
                    {t('upload.sheet.addRow', { defaultValue: 'Row' })}
                </Button>
                <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={addColumn}
                    sx={{ textTransform: 'none' }}
                >
                    {t('upload.sheet.addColumn', { defaultValue: 'Column' })}
                </Button>
                <Tooltip title={t('upload.sheet.clearTooltip', { defaultValue: 'Clear the sheet' })}>
                    <span>
                        <Button
                            size="small"
                            color="inherit"
                            startIcon={<DeleteSweepIcon />}
                            onClick={clearSheet}
                            disabled={isSheetEmpty(cells)}
                            sx={{ textTransform: 'none' }}
                        >
                            {t('upload.sheet.clear', { defaultValue: 'Clear' })}
                        </Button>
                    </span>
                </Tooltip>
            </Box>

            <Typography variant="caption" color="text.secondary">
                {t('upload.sheet.pasteHint', {
                    defaultValue: 'Type directly, or copy a range from Excel and paste (Ctrl/Cmd+V). Formatting is preserved.',
                })}
            </Typography>

            {/* Grid */}
            <Box
                ref={containerRef}
                onPaste={handlePaste}
                sx={{
                    flex: 1,
                    minHeight: 120,
                    overflow: 'auto',
                    border: `1px solid ${borderColor.view}`,
                    borderRadius: radius.sm,
                }}
            >
                <Box
                    component="table"
                    sx={{
                        borderCollapse: 'collapse',
                        width: 'max-content',
                        minWidth: '100%',
                        fontSize: 12,
                    }}
                >
                    <Box component="thead">
                        <Box component="tr">
                            {/* Corner */}
                            <Box
                                component="th"
                                sx={{
                                    position: 'sticky',
                                    left: 0,
                                    top: 0,
                                    zIndex: 3,
                                    width: 40,
                                    minWidth: 40,
                                    backgroundColor: theme.palette.background.paper,
                                    border: `1px solid ${borderColor.divider}`,
                                }}
                            />
                            {Array.from({ length: renderColCount }, (_, c) => (
                                <Box
                                    component="th"
                                    key={`col-${c}`}
                                    sx={{
                                        position: 'sticky',
                                        top: 0,
                                        zIndex: 2,
                                        minWidth: 110,
                                        backgroundColor: theme.palette.background.paper,
                                        border: `1px solid ${borderColor.divider}`,
                                        px: 0.5,
                                        py: 0.25,
                                    }}
                                >
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                        }}
                                    >
                                        <Typography
                                            variant="caption"
                                            sx={{ color: 'text.secondary', fontWeight: 600 }}
                                        >
                                            {columnLabel(c)}
                                        </Typography>
                                        <Tooltip
                                            title={t('upload.sheet.deleteColumn', {
                                                defaultValue: 'Delete column',
                                            })}
                                        >
                                            <IconButton
                                                size="small"
                                                onClick={() => deleteColumn(c)}
                                                sx={{ p: 0.1, opacity: 0.5, '&:hover': { opacity: 1 } }}
                                            >
                                                <CloseIcon sx={{ fontSize: 12 }} />
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                    <Box component="tbody">
                        {Array.from({ length: renderRowCount }, (_, r) => {
                            const isHeaderRow = firstRowHeader && r === 0;
                            return (
                                <Box component="tr" key={`row-${r}`}>
                                    {/* Row number / delete */}
                                    <Box
                                        component="td"
                                        sx={{
                                            position: 'sticky',
                                            left: 0,
                                            zIndex: 1,
                                            width: 40,
                                            minWidth: 40,
                                            textAlign: 'center',
                                            backgroundColor: theme.palette.background.paper,
                                            border: `1px solid ${borderColor.divider}`,
                                            '&:hover .row-delete': { display: 'inline-flex' },
                                            '&:hover .row-number': { display: 'none' },
                                        }}
                                    >
                                        <Typography
                                            className="row-number"
                                            variant="caption"
                                            sx={{ color: 'text.secondary' }}
                                        >
                                            {isHeaderRow
                                                ? t('upload.sheet.headerRowMark', { defaultValue: 'H' })
                                                : firstRowHeader
                                                ? r
                                                : r + 1}
                                        </Typography>
                                        <Tooltip
                                            title={t('upload.sheet.deleteRow', { defaultValue: 'Delete row' })}
                                        >
                                            <IconButton
                                                className="row-delete"
                                                size="small"
                                                onClick={() => deleteRow(r)}
                                                sx={{ display: 'none', p: 0.1 }}
                                            >
                                                <CloseIcon sx={{ fontSize: 12 }} />
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                    {Array.from({ length: renderColCount }, (_, c) => {
                                        const cell = cells[r]?.[c] ?? { value: '' };
                                        const isActive = active[0] === r && active[1] === c;
                                        return (
                                            <Box
                                                component="td"
                                                key={`cell-${r}-${c}`}
                                                sx={{
                                                    border: `1px solid ${borderColor.divider}`,
                                                    p: 0,
                                                    ...(isHeaderRow ? headerCellSx : {}),
                                                    ...(isActive
                                                        ? {
                                                              outline: `2px solid ${theme.palette.primary.main}`,
                                                              outlineOffset: '-2px',
                                                          }
                                                        : {}),
                                                }}
                                            >
                                                <input
                                                    data-row={r}
                                                    data-col={c}
                                                    value={cell.value}
                                                    onChange={(e) => updateCell(r, c, e.target.value)}
                                                    onFocus={() => setActive([r, c])}
                                                    onKeyDown={(e) => handleKeyDown(e, r, c)}
                                                    style={{
                                                        width: '100%',
                                                        boxSizing: 'border-box',
                                                        border: 'none',
                                                        outline: 'none',
                                                        padding: '4px 6px',
                                                        fontSize: 12,
                                                        fontFamily: 'inherit',
                                                        ...cellStyleToCss(cell),
                                                        ...(isHeaderRow ? { fontWeight: 'bold' } : {}),
                                                    }}
                                                />
                                            </Box>
                                        );
                                    })}
                                </Box>
                            );
                        })}
                    </Box>
                </Box>
            </Box>

            {(hasHiddenRows || hasHiddenCols) && (
                <Typography variant="caption" color="text.secondary">
                    {hasHiddenRows &&
                        t('upload.sheet.moreRows', {
                            defaultValue: '{{n}} more rows not shown — all will be imported.',
                            n: numRows - renderRowCount,
                        })}
                    {hasHiddenRows && hasHiddenCols ? ' ' : ''}
                    {hasHiddenCols &&
                        t('upload.sheet.moreCols', {
                            defaultValue: '{{n}} more columns not shown — all will be imported.',
                            n: numCols - renderColCount,
                        })}
                </Typography>
            )}
        </Box>
    );
};
