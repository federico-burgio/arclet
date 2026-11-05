# Arclet interchange format — version 2

This is the public JSON format for Arclet import and export. A converter from Arc or another browser can produce this format without depending on Arclet's internal storage. Arclet does not read Arc's proprietary sidebar JSON directly.

- [Download an example](import-example.json)
- [JSON Schema](import-format.schema.json)
- Format identifier: `"format": "arclet"`
- Current export version: `"version": 2` (independent of the extension version). Version 1 files remain importable. Version 2 adds repeated pinned URLs, controls-only navigation, and separate Home, Email, and Calendar destinations.

## Minimal file

```json
{
  "format": "arclet",
  "version": 2,
  "favorites": [{ "url": "https://example.com/", "title": "Example" }],
  "spaces": [{ "name": "Reading", "items": [] }]
}
```

Use **Settings → Import & export → Import JSON** to select a file and review its preview. Nothing is imported until you click **Import**. The format guide in Settings links to this document; the example download is also bundled with the extension for offline use.

## Document fields

| Field | Required | Meaning |
| --- | --- | --- |
| `format` | Yes | Exactly `"arclet"`. |
| `version` | Yes | Integer `1` or `2`. New exports use `2`; other versions are rejected. |
| `spaces` | At least this or `favorites` | Array of spaces, in sidebar order. May be empty. |
| `favorites` | At least this or `spaces` | Array of favorite pages, in display order. May be empty. |
| `settings` | No | Optional appearance, navigation, and control-favorite settings, described below. |
| `exportedAt` | No | Export timestamp as an ISO date string; ignored when merging. |

Version 1 settings retain their original fields; controls-only and control-favorite fields require version 2.

Files must be UTF-8 JSON, at most **5 MiB**, with at most **10,000 records** total (spaces, folders, pins, favorites, and configured Home, Email, and Calendar destinations). Unknown fields, invalid values, unsupported URL schemes, and nested folders are rejected with a field path. The whole file is validated before any data is imported. No pages are fetched during import.

## Spaces

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | Required | Nonempty name, up to 32 characters. Unique within the file. |
| `color` | `"slate"` | `iris`, `sage`, `sand`, `rose`, `ocean`, or `slate`. |
| `backgroundColor` | `null` | A six-digit hex color such as `"#d5e5da"`, or null to use the palette. |
| `icon` | `"sun"` | A bundled icon name. |
| `iconColor` | `null` | Six-digit hex color, or null for automatic color. |
| `items` | `[]` | Ordered array mixing pins and folders. |

There may be at most 12 spaces in a file. The merged sidebar must also fit Arclet's 12-space limit. Choose fewer spaces or remove existing spaces if an import would exceed the limit; Arclet never silently discards spaces.

## Pages and folders

Favorites use page objects. Pinned pages use the same fields plus `"type": "pin"`:

```json
{ "type": "pin", "title": "Example", "url": "https://example.com/", "icon": null, "iconColor": null }
```

- `url` is required, up to 5,242,880 characters, and must use HTTP or HTTPS. It is normalized with the URL parser. Browser-internal, `file:`, `javascript:`, and `data:` URLs are not supported saved pages.
- `title` is optional, nonempty, and up to 200 characters. If omitted, the site's hostname is used.
- `icon` is optional or null for the site's favicon. `iconColor` is optional or null for automatic color; it is ignored when no custom icon is selected.
- Favorite URLs must be unique within `favorites`. Version 2 permits repeated pinned URLs, including within one folder or space: each occurrence is a separate saved item. Version 1 retains its original requirement that pinned URLs be unique per space. A URL may also appear in different spaces, or as both a favorite and a pin.

Folders appear only in a space's root `items` array:

```json
{
  "type": "folder",
  "name": "Reference",
  "icon": "folder",
  "iconColor": "#477fc1",
  "collapsed": false,
  "items": [{ "type": "pin", "url": "https://example.com/" }]
}
```

Folder names are required, nonempty, up to 64 characters, and unique within their space. `icon` defaults to `folder`, `iconColor` to null, `collapsed` to false, and `items` to an empty array. Empty folders are supported. Folder children can only be pins: both versions support **one folder level**.

Space, folder, and custom page icons must be names from Arclet's bundled Lucide catalog, such as `sun`, `briefcase`, `book-open`, `folder`, or `globe`. See the searchable icon picker in Arclet or [the bundled catalog](../src/icon-catalog.js). The existing aliases (`close`, `more`, `chevronDown`, `sliders`, `volume`, `muted`, `arrow`, `edit`) are accepted. Arbitrary SVG, image URLs, and emoji are not supported icon values. A converter should use a suitable fallback icon for unsupported source icons.

## Optional settings

All settings are optional. They are validated when present, but applied **only if the user enables “Apply settings” in the import preview**. That switch is off by default. Omitted settings keep their current values.

| Field | Accepted values |
| --- | --- |
| `theme` | `"system"`, `"light"`, `"dark"` |
| `backgroundColor` | Six-digit hex color or null |
| `showSearchBar` | Boolean; false hides the entire toolbar |
| `showUrlBar` | Boolean (v2); false keeps navigation controls and hides the URL/search field when the toolbar is enabled |
| `homeUrl` | HTTP/HTTPS URL or null (v2); separate Home favorite destination |
| `homeTitle` | Nonempty string, up to 200 characters (v2); saved Home name |
| `emailUrl`, `calendarUrl` | HTTP/HTTPS URL or null (v2); separate Email and Calendar destinations |
| `emailTitle`, `calendarTitle` | Nonempty string, up to 200 characters (v2); saved names |
| `pageControlsPosition` | `"left"` or `"right"`; if omitted, keep the current position |
| `showFavoriteLabels` | Boolean |
| `favoritesPerRow` | Integer 1–8 |
| `fontScale` | `90`, `100`, `110`, `125`, `150` |

## Merge and conflict rules

1. Space and folder names match **exactly**, including case, after surrounding whitespace is removed from the file's names. An existing space with that name is merged; an existing folder with that name inside the space is merged. Existing appearance, folder collapse state, and order are kept.
2. New spaces, root pins/folders, folder children, and favorites are appended in their source order. New items keep their imported appearance.
3. Favorite URLs already present globally are skipped. For pins, occurrences of each URL are counted per space. Existing occurrences are retained with their folder and title; any additional occurrences in the file are appended in source order. This preserves duplicate pins on a fresh import and makes repeated imports idempotent. Matching uses the full normalized URL, including its query and fragment; it does not merge unrelated paths or strip tracking parameters.
4. If multiple existing spaces or folders match a name, the import is rejected with an instruction to rename one. It does not guess which to use.
5. Reimporting the same file does not add extra spaces, folders, or URL occurrences. The preview reports new and merged records and the number of existing URLs skipped.
6. If saved sidebar data or preferences change after preview, confirmation is rejected. Choose the file again to review a fresh preview. Live tab navigation alone does not invalidate a preview.
7. Import does not create, navigate, close, reassign, or activate browser tabs. Imported saved items start closed. Opening one can adopt an eligible unassociated tab at its saved URL; import itself does not take ownership of live tabs.

## Export scope

**Export JSON** downloads the current version 2 format with all spaces, favorites, pinned pages, folders, ordering, colors, custom icons, folder collapse state, and settings. Its output can be imported by Arclet or used by external conversion tools.

Chrome's live tabs, tab/window IDs, selected space in each window, tab recovery checkpoint, history, cookies, passwords, accounts, and device-specific Sync preference/state are not exported. Parsing, merging, and export generation happen locally. Import does not enable Sync. If Sync is already enabled, the merged configuration must also fit its 80 KiB working limit and will be queued for Chrome Sync after it is saved locally.

If existing spaces have duplicate names, export gives subsequent occurrences unique names such as `Work (2)`, shortening the base name to stay within the limit. The same rule applies to duplicate folder names within a space. This preserves separate groups in a portable file without modifying the original sidebar. Renaming those groups in Arclet before exporting is preferable if you plan to merge the file back into the same sidebar.

## Validation and schema

The [JSON Schema](import-format.schema.json) describes the object shapes and field limits. Runtime validation additionally checks the bundled icon registry, canonical URL uniqueness, unique space/folder names, combined record count, and the destination's space limit. A schema-valid document can still fail those checks.

The parser implementation is [src/transfer.js](../src/transfer.js). Breaking format changes require a new format version; do not treat the internal `chrome.storage.local` data as this public format.
