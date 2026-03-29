import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TokenColor {
  name?: string;
  scope?: string | string[];
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

interface ThemeJson {
  tokenColors?: TokenColor[];
  include?: string;
}

export interface ResolvedTokenStyle {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

// ─── Minimal JSONC parser (strips comments without breaking strings) ────────────

function parseJsonc(text: string): unknown {
  let result = "";
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    // Handle escape sequences in strings
    if (inString && escape) {
      result += char;
      escape = false;
      continue;
    }

    if (inString && char === "\\") {
      result += char;
      escape = true;
      continue;
    }

    // Toggle string state
    if (char === '"' && !inSingleLineComment && !inMultiLineComment) {
      inString = !inString;
      result += char;
      continue;
    }

    // Skip if inside a string
    if (inString) {
      result += char;
      continue;
    }

    // Handle single-line comments (only outside strings)
    if (!inMultiLineComment && char === "/" && nextChar === "/") {
      inSingleLineComment = true;
      i++; // Skip next char
      continue;
    }

    // Handle multi-line comments (only outside strings)
    if (!inSingleLineComment && char === "/" && nextChar === "*") {
      inMultiLineComment = true;
      i++; // Skip next char
      continue;
    }

    // End single-line comment at newline
    if (inSingleLineComment && char === "\n") {
      inSingleLineComment = false;
      result += char; // Keep newlines to preserve structure
      continue;
    }

    // End multi-line comment
    if (inMultiLineComment && char === "*" && nextChar === "/") {
      inMultiLineComment = false;
      i++; // Skip next char
      continue;
    }

    // Only add character if not in any comment
    if (!inSingleLineComment && !inMultiLineComment) {
      result += char;
    }
  }

  // Strip trailing commas (before } or ])
  result = result.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(result);
}

// ─── Load theme JSON, following `include` chains ─────────────────────────────

function loadThemeTokenColors(
  themePath: string,
  visited = new Set<string>()
): TokenColor[] {
  if (visited.has(themePath)) {
    return [];
  }
  visited.add(themePath);

  let raw: string;
  try {
    raw = fs.readFileSync(themePath, "utf8");
  } catch {
    return [];
  }

  let theme: ThemeJson;
  try {
    theme = parseJsonc(raw) as ThemeJson;
  } catch {
    return [];
  }

  let tokenColors: TokenColor[] = theme.tokenColors ?? [];

  // Follow `include` (e.g. Dark+ extends Dark)
  if (theme.include) {
    const includePath = path.resolve(path.dirname(themePath), theme.include);
    const parentColors = loadThemeTokenColors(includePath, visited);
    // Parent rules come first; child rules override
    tokenColors = [...parentColors, ...tokenColors];
  }

  return tokenColors;
}

// ─── Find the active theme's JSON file ───────────────────────────────────────

function findActiveThemeFile(): string | undefined {
  const currentThemeId = vscode.workspace
    .getConfiguration("workbench", null)
    .get<string>("colorTheme");

  if (!currentThemeId) {
    return undefined;
  }

  for (const ext of vscode.extensions.all) {
    const themes = ext.packageJSON?.contributes?.themes as
      | Array<{ id?: string; label?: string; path?: string }>
      | undefined;

    if (!themes) {
      continue;
    }

    for (const theme of themes) {
      const themeId = theme.id ?? theme.label;
      if (themeId === currentThemeId && theme.path) {
        return path.join(ext.extensionPath, theme.path);
      }
    }
  }

  return undefined;
}

// ─── Score a scope selector against a token scope ────────────────────────────
// Higher score = more specific match.
// e.g. "keyword.control" scores higher than "keyword" for "keyword.control.if"

function matchScore(selector: string, tokenScope: string): number {
  const sel = selector.trim();
  if (tokenScope === sel) {
    return 1000 + sel.length; // exact match wins
  }
  if (tokenScope.startsWith(sel + ".")) {
    return sel.length; // prefix match — longer prefix = higher score
  }
  return -1; // no match
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolves a TextMate scope string against the currently active theme and
 * returns the color / style that the theme would apply to that scope.
 *
 * Returns an empty object if the scope cannot be resolved.
 */
export function resolveScope(targetScope: string): ResolvedTokenStyle {
  const themePath = findActiveThemeFile();
  if (!themePath) {
    return {};
  }

  const tokenColors = loadThemeTokenColors(themePath);

  let bestScore = -1;
  let bestSettings: TokenColor["settings"] = {};

  for (const rule of tokenColors) {
    // scope can be a string, a comma-separated string, or an array
    const rawScopes = rule.scope ?? [];
    const scopes: string[] = Array.isArray(rawScopes)
      ? rawScopes
      : rawScopes.split(",").map((s) => s.trim());

    for (const selector of scopes) {
      const score = matchScore(selector, targetScope);
      if (score > bestScore) {
        bestScore = score;
        bestSettings = rule.settings;
      }
    }
  }

  if (bestScore < 0) {
    return {}; // no rule matched
  }

  const fontStyle = bestSettings.fontStyle ?? "";
  return {
    color: bestSettings.foreground,
    backgroundColor: bestSettings.background,
    bold: fontStyle.includes("bold"),
    italic: fontStyle.includes("italic"),
    underline: fontStyle.includes("underline"),
  };
}
