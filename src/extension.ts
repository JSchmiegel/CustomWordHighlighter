import * as vscode from "vscode";
import { resolveScope, ResolvedTokenStyle } from "./themeResolver";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroupStyle {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  border?: string;
}

interface HighlightRule {
  word: string;
  isRegex?: boolean;
  wholeWord?: boolean;
  caseSensitive?: boolean;
  scope?: string;         // TextMate scope for color inheritance (optional, overridden by explicit color)
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  border?: string;
  groups?: GroupStyle[];  // For regex capture groups (indexed by group number, starting at 1)
  priority?: number;      // Lower priority wins on overlaps (default: 0)
}

interface ActiveDecoration {
  decorationType: vscode.TextEditorDecorationType;
  groupDecorationTypes: (vscode.TextEditorDecorationType | null)[];  // null for unstyled groups
  rule: HighlightRule;
}

// ─── Decoration cache ─────────────────────────────────────────────────────────

let activeDecorations: ActiveDecoration[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildRegex(rule: HighlightRule): RegExp {
  const flags = rule.caseSensitive ? "g" : "gi";
  if (rule.isRegex) {
    return new RegExp(rule.word, flags);
  }
  const escaped = rule.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = rule.wholeWord !== false ? `\\b${escaped}\\b` : escaped;
  return new RegExp(pattern, flags);
}

function createDecorationType(
  rule: HighlightRule
): vscode.TextEditorDecorationType {
  // Resolve scope-based colors if scope is specified
  let inherited: ResolvedTokenStyle = {};
  if (rule.scope) {
    inherited = resolveScope(rule.scope);
    console.log(`Resolved scope "${rule.scope}" to:`, inherited);
  }

  // Explicit values override inherited ones
  const color = rule.color ?? inherited.color;
  const backgroundColor = rule.backgroundColor ?? inherited.backgroundColor;
  const bold = rule.bold ?? inherited.bold;
  const italic = rule.italic ?? inherited.italic;
  const underline = rule.underline ?? inherited.underline;

  return vscode.window.createTextEditorDecorationType({
    color,
    backgroundColor: backgroundColor || undefined,
    fontWeight: bold ? "bold" : undefined,
    fontStyle: italic ? "italic" : undefined,
    textDecoration: underline ? "underline" : undefined,
    border: rule.border ?? undefined,
    borderRadius: rule.border ? "3px" : undefined,
  });
}

function createGroupDecorationTypes(
  rule: HighlightRule
): (vscode.TextEditorDecorationType | null)[] {
  return (rule.groups ?? []).map((group) => {
    // Check if group has any styling
    const hasStyling = 
      group.color ||
      group.backgroundColor ||
      group.bold ||
      group.italic ||
      group.underline ||
      group.border;

    if (!hasStyling) {
      return null; // No styling for this group
    }

    return vscode.window.createTextEditorDecorationType({
      color: group.color,
      backgroundColor: group.backgroundColor || undefined,
      fontWeight: group.bold ? "bold" : undefined,
      fontStyle: group.italic ? "italic" : undefined,
      textDecoration: group.underline ? "underline" : undefined,
      border: group.border ?? undefined,
      borderRadius: group.border ? "3px" : undefined,
    });
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function getRules(document?: vscode.TextDocument): HighlightRule[] {
  const config = vscode.workspace.getConfiguration(
    "wordHighlighter",
    document?.uri
  );
  return config.get<HighlightRule[]>("rules") ?? [];
}

// ─── Rebuild decoration types (called when settings or theme changes) ─────────

function rebuildDecorationTypes(document?: vscode.TextDocument): void {
  for (const d of activeDecorations) {
    d.decorationType.dispose();
    d.groupDecorationTypes.forEach((gdt) => {
      if (gdt !== null) gdt.dispose();
    });
  }
  activeDecorations = [];

  const rules = getRules(document);
  for (const rule of rules) {
    if (!rule.word) {
      continue;
    }
    activeDecorations.push({
      decorationType: createDecorationType(rule),
      groupDecorationTypes: createGroupDecorationTypes(rule),
      rule,
    });
  }
}

// ─── Apply decorations to one editor ──────────────────────────────────────────

function applyDecorations(editor: vscode.TextEditor): void {
  const text = editor.document.getText();

  // Sort by priority (ascending) so lower priority rules are processed first and can be overridden
  const sortedDecorations = [...activeDecorations].sort((a, b) => {
    const priorityA = a.rule.priority ?? 0;
    const priorityB = b.rule.priority ?? 0;
    return priorityA !== priorityB ? priorityA - priorityB : 0; // Stable sort by array order if priority is equal
  });

  // Track claimed character offsets per priority level
  // Only higher-priority (lower number) rules can claim offsets that block lower-priority rules
  const claimedOffsets = new Set<number>();

  for (const { decorationType, groupDecorationTypes, rule } of sortedDecorations) {
    const ranges: vscode.Range[] = [];
    const groupRanges: vscode.Range[][] = groupDecorationTypes.map(() => []);

    let regex: RegExp;
    try {
      regex = buildRegex(rule);
    } catch {
      editor.setDecorations(decorationType, []);
      groupDecorationTypes.forEach((gdt) => {
        if (gdt !== null) editor.setDecorations(gdt, []);
      });
      continue;
    }

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;

      // Check if any character in this match is already claimed by a higher-priority rule
      let isBlocked = false;
      for (let i = matchStart; i < matchEnd; i++) {
        if (claimedOffsets.has(i)) {
          isBlocked = true;
          break;
        }
      }

      if (isBlocked) {
        if (match[0].length === 0) {
          regex.lastIndex++;
        }
        continue; // Skip this match
      }

      // Claim these offsets
      for (let i = matchStart; i < matchEnd; i++) {
        claimedOffsets.add(i);
      }

      const start = editor.document.positionAt(matchStart);
      const end = editor.document.positionAt(matchEnd);

      ranges.push(new vscode.Range(start, end));

      // Apply group-specific decorations
      // Use a more robust method to find group positions
      for (let i = 1; i < match.length; i++) {
        if (match[i] !== undefined && i - 1 < groupRanges.length) {
          const groupValue = match[i];
          
          // For each group, we need to find its position in the original text
          const groupStr = String(groupValue);
          const matchStr = String(match[0]);
          
          // Simple approach: search from the beginning
          const foundIndex = matchStr.indexOf(groupStr);
          
          if (foundIndex >= 0) {
            const groupStart = matchStart + foundIndex;
            const groupEnd = groupStart + groupStr.length;
            const gStart = editor.document.positionAt(groupStart);
            const gEnd = editor.document.positionAt(groupEnd);
            groupRanges[i - 1].push(new vscode.Range(gStart, gEnd));
          }
        }
      }

      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }

    // Remove group ranges from main decoration ranges so group colors can show through
    const groupOffsets = new Set<number>();
    for (const groupRange of groupRanges) {
      for (const range of groupRange) {
        for (let line = range.start.line; line <= range.end.line; line++) {
          for (let char = (line === range.start.line ? range.start.character : 0);
               char <= (line === range.end.line ? range.end.character : Infinity);
               char++) {
            groupOffsets.add(line * 100000 + char); // Simple hash: line*100000+char
          }
        }
      }
    }

    // Filter main ranges to exclude group ranges
    const filteredRanges = ranges.filter(range => {
      // Check if this range overlaps with any group range
      for (const groupRange of groupRanges) {
        for (const gRange of groupRange) {
          if (
            (range.start.line < gRange.end.line ||
              (range.start.line === gRange.end.line &&
                range.start.character < gRange.end.character)) &&
            (range.end.line > gRange.start.line ||
              (range.end.line === gRange.start.line &&
                range.end.character > gRange.start.character))
          ) {
            return false; // Overlaps with a group, exclude it
          }
        }
      }
      return true;
    });

    editor.setDecorations(decorationType, filteredRanges);
    groupDecorationTypes.forEach((gdt, i) => {
      if (gdt !== null) {
        editor.setDecorations(gdt, groupRanges[i]);
      }
    });
  }
}

// ─── Refresh all visible editors ──────────────────────────────────────────────

function refreshAllEditors(): void {
  for (const editor of vscode.window.visibleTextEditors) {
    applyDecorations(editor);
  }
}

// ─── Activation ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  rebuildDecorationTypes(vscode.window.activeTextEditor?.document);
  refreshAllEditors();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        rebuildDecorationTypes(editor.document);
        applyDecorations(editor);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === event.document) {
        applyDecorations(editor);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("wordHighlighter.rules")) {
        rebuildDecorationTypes(vscode.window.activeTextEditor?.document);
        refreshAllEditors();
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        applyDecorations(editor);
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      // Re-resolve all scopes when the theme changes
      rebuildDecorationTypes(vscode.window.activeTextEditor?.document);
      refreshAllEditors();
    })
  );
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

export function deactivate(): void {
  for (const d of activeDecorations) {
    d.decorationType.dispose();
    d.groupDecorationTypes.forEach((gdt) => {
      if (gdt !== null) gdt.dispose();
    });
  }
  activeDecorations = [];
}
