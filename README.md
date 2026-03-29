# Custom Word Highlighter — VS Code Extension

Highlight any code words or regex patterns in your workspace by editing `.vscode/settings.json`.

- **Instant updates** — changes apply immediately without reloading
- **Regex support** — match complex patterns with capture groups
- **Per-group styling** — color each capture group differently
- **Priority control** — lower priority numbers win on overlaps
- **Theme integration** — inherit colors from your active theme via TextMate scopes


## Configuration

Add `wordHighlighter.rules` to your workspace `.vscode/settings.json`:

```jsonc
{
  "wordHighlighter.rules": [

    // Simple word with explicit color
    { 
      "word": "TODO",
      "color": "#FF6B6B",
      "bold": true
    },

    // Inherit color from theme scope (keyword.control)
    {
      "word": "await",
      "scope": "keyword.control"
    },

    // Inherit from scope but override with explicit color
    {
      "word": "async",
      "scope": "keyword.control",
      "color": "#FF00FF"     // Overrides scope-inherited color
    },

    // Word with background highlight
    { 
      "word": "FIXME",
      "backgroundColor": "#2a0000",
      "color": "#FF0000"
    },

    // Whole-word matching (default)
    { 
      "word": "myVar",
      "color": "#00FFCC",
      "underline": true
    },

    // Regex with capture group styling
    {
      "word": "(\\\\citefull\\{([a-zA-Z0-9]+)\\})",
      "isRegex": true,
      "color": "#9C83F8",
      "priority": 10,
      "groups": [
        {
          "color": "#9C83F8"
        },
        {
          "color": "#00FF00",
          "bold": true
        }
      ]
    },

    // Regex with empty group (no styling)
    {
      "word": "(\\w+)\\((.*?)\\)",
      "isRegex": true,
      "color": "#FF6B6B",
      "priority": 5,
      "groups": [
        { "bold": true },
        {}                // No styling for this group
      ]
    }

  ]
}
```

---

## Rule Properties

| Property          | Type      | Default | Description |
|-------------------|-----------|---------|-------------|
| `word`            | `string`  | —       | **Required.** Word or regex pattern to match. |
| `isRegex`         | `boolean` | `false` | Treat `word` as a regular expression. Enables capture groups via `groups` property. |
| `wholeWord`       | `boolean` | `true`  | Only match whole words (ignored when `isRegex` is true). |
| `caseSensitive`   | `boolean` | `false` | Case-sensitive matching. |
| `scope`           | `string`  | —       | TextMate scope name to inherit color from the active theme (e.g., `"keyword.control"`). Explicit `color` always overrides. Use **Developer: Inspect Editor Tokens and Scopes** command to find scope names. |
| `color`           | `string`  | —       | Foreground hex color (e.g., `"#FF6600"`). Overrides scope-inherited color. |
| `backgroundColor` | `string`  | —       | Background hex color. |
| `bold`            | `boolean` | `false` | Bold text. |
| `italic`          | `boolean` | `false` | Italic text. |
| `underline`       | `boolean` | `false` | Underline text. |
| `border`          | `string`  | —       | CSS border, e.g. `"1px solid #FF6600"`. |
| `priority`        | `number`  | `0`     | Lower priority numbers win on overlaps. Groups within the same match override each other freely. |
| `groups`          | `array`   | —       | Array of styling objects for regex capture groups. Each element can be empty `{}` for no styling, or include any of: `color`, `backgroundColor`, `bold`, `italic`, `underline`, `border`. |


## TextMate Scope Resolution

The `scope` property allows you to inherit colors and styles from the active VS Code theme by matching TextMate scope names.

**How it works:**
1. When you specify `scope: "keyword.control"`, the extension looks up that scope in the active theme
2. The theme's color for that scope (if any) is inherited by your rule
3. [Explicit properties always override](#rule-properties) scope-inherited values

**Finding scope names:**
- Open any code file in VS Code
- Press `Ctrl+K Ctrl+I` (or `Cmd+K Cmd+I` on Mac), or use **Developer: Inspect Editor Tokens and Scopes** command
- Hover over code to see its scope name(s)

**Example:**
```json
{
  "wordHighlighter.rules": [
    // If your theme colors "keyword.control" red, this rule inherits that red:
    { "word": "if", "scope": "keyword.control" },
    
    // Override with explicit color (takes priority):
    { "word": "else", "scope": "keyword.control", "color": "#00FF00" }
  ]
}
```

When you switch themes, scope-inherited colors automatically update to match the new theme.

---

## How Overlaps Work

When two rules' matches overlap:
1. Rules are sorted by **priority** (ascending: lower number = higher priority)
2. Higher-priority matches claim their character ranges
3. Lower-priority matches skip any ranges already claimed by higher-priority rules

**Example:**
```json
{
  "wordHighlighter.rules": [
    { "word": "Toast", "color": "#FF0000", "priority": 0 },
    { "word": "ast", "color": "#00FF00", "priority": 5 }
  ]
}
```

Result:
- "Toast" is entirely red (priority 0 < 5, wins)
- Standalone "ast" elsewhere is green
- "ast" inside "Toast" is **not highlighted** (range claimed by higher-priority rule)

---

## Regex Capture Groups

Use `groups` to style individual capture groups differently:

```json
{
  "word": "(\\\\citefull\\{([a-zA-Z0-9]+)\\})",
  "isRegex": true,
  "color": "#9C83F8",
  "groups": [
    { "color": "#9C83F8" },                    // group 1
    { "color": "#00FF00", "bold": true }       // group 2 (overrides group 1)
  ]
}
```

- **Groups can be empty**: Use `{}` to match a group without styling it
- **Groups override each other**: Later groups in the array layer on top
- **Main color is excluded**: Group ranges are removed from the main decoration so group colors show through

**Note:** Overwriting of the foreground color is not supported. This is due to a VS Code decision. VS Code Themes have the same problem.

---

## Technical Notes

### Theme File Compatibility

The extension automatically parses your active theme's JSON file to resolve TextMate scopes. It supports:
- **Single-line comments** (`// ...`)
- **Multi-line comments** (`/* ... */`)
- **Trailing commas** (JSONC syntax)
- **Include chains** (themes that extend other themes, like Dark+ extending Dark)
- **URLs in strings** (won't break on `https://` or similar)

This means the extension works with virtually all VS Code theme files, including complex ones with inline documentation.

### Performance

- Scope resolution happens once when a rule with a `scope` property is first used
- Theme colors are cached and automatically re-resolved when you switch themes
- The extension is lightweight and doesn't impact editor performance even with dozens of rules
