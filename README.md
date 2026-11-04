# Arclet

A working, Arc-inspired Chrome extension: soft colors, vertical tabs, spaces, favorites, and pinned folders. Vanilla JavaScript, Manifest V3, no runtime dependencies or build step. Lucide SVG assets are bundled locally.

## Install in Chrome

1. Use Chrome 116 or newer.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and choose this folder (the folder containing `manifest.json`).
4. Pin **Arclet** in Chrome’s extensions menu, then click its icon to open the sidebar.
5. For the Arc-style position, set the side panel to **Left** in Chrome’s **Settings → Appearance**. Chrome controls the panel position and width.

The default shortcut is **⌘ Shift E** on macOS or **Ctrl Shift E** elsewhere. Change it at `chrome://extensions/shortcuts` if another extension already uses it.

## What works

- **Live vertical tabs** for the current Chrome window. Switch, close, mute, and restore the last closed tab. Right-click an open tab for **Close all tabs** or **Close all tabs below**. These actions close only the visible Open tabs list in that space and window; saved pins/favorites and other spaces stay open. “Below” follows the current displayed order and keeps the clicked tab open. New tab and the empty content area also offer **Close all tabs**. Recently closed tabs remain restorable.
- **Spaces** with names, icons, and six color palettes. New spaces use Slate gray by default. The selected footer tab shows its name and connects to a subtly colored folder containing its tabs. The surrounding background uses the theme’s gray unless you choose a custom background color. The selector sits at the footer’s left edge. Add a space with its plus button; right-click a space to edit it.
- **Drag and drop** to reorder tabs, or drop a tab onto a space icon to move it. A tab’s right-click menu also provides a keyboard-accessible way to move it (Shift F10).
- **Favorites** shared by all spaces. Right-click an open tab or pinned page and choose **Add to favorites**. A pinned page can be saved as a favorite even when its browser tab is closed. Matching live tabs are hidden from the Open tabs list in every space, while staying open in Chrome and searchable. Right-click a favorite and choose **Remove favorite** to remove it; its live tabs reappear unless they are also pinned in that space. Drag favorite tiles to rearrange them, including across wrapped rows; insertion markers show the destination and Escape cancels. Their global order survives restarts. Use Alt+← / Alt+→ or the context menu’s Move left / Move right actions for keyboard ordering. Empty favorites sections are hidden.
- **Pinned pages** per space. Right-click an open tab and choose **Pin to this space**. These are durable shortcuts: closing the live tab keeps the saved page. Clicking a saved page focuses an existing matching tab in the space or opens it again. Pages pinned in a space are hidden from that space’s Open tabs list; their underlying Chrome tabs stay open and remain searchable. Unpinning a page makes its live tabs reappear. Right-click a pinned page to favorite, mute, close its live tab, or unpin it.
- **Pinned folders** per space. Right-click a space, **New tab**, or the empty content area and choose **New pinned folder**. Right-click a pinned page → **Move to folder** to file it, move it out, or create a folder containing it. You can also drag a pinned page or open tab onto a folder heading. Drag pinned pages or folder headings to reorder them, including placing folders between loose pins. Drop a page in a folder heading’s center to file it; use its top or bottom edge to insert beside the folder. Drag onto a page to insert before or after it, or use the “Drop here outside folders” area to unfile a page. Empty folder areas accept drops too. Insertion lines and folder highlights show the destination. Escape cancels a drag; long lists scroll near their edges. Click a folder to collapse or expand it; membership, order, and collapse state survive restarts. Right-click a folder to rename it, change its icon, or remove the folder while keeping its pages. Folders are one level deep. For keyboard ordering, focus a pin or folder and press Alt+↑ / Alt+↓, or use its right-click menu’s Move up / Move down actions.
- **Custom icons and colors** for spaces, pinned folders, pinned pages, and favorites. Choose from 2,019 searchable [Lucide](https://lucide.dev/) outline icons, with preset colors, a custom color picker, or an automatic theme color. Right-click saved pages → **Customize icon**; **Use site icon** restores the favicon. Edit a space or folder to choose its icon separately from the space’s background palette. The entire library works offline.
- **A simpler tab list:** no Open tabs heading or count bar. Right-click **New tab** or the selected space to **Restore last closed tab**.
- **Search and navigation** with **⌘ K / Ctrl K**, while the sidebar has keyboard focus. Search tabs across spaces, switch with arrow keys and Enter, or click the bottom result to open a URL or Google search. Bare domains and localhost addresses work.
- **New tab** opens Chrome’s new-tab page directly in the selected space and current window. Search remains available from the search bar or **⌘ K / Ctrl K**.
- **Clear regular tabs:** the broom button at the right of the **New tab** row closes regular tabs in the selected space and current window. Chrome-pinned tabs, Arclet pinned pages, favorites, and tabs in other spaces/windows stay open. The button is disabled when there is nothing eligible to close. Closed tabs can be restored as usual.
- **Current-page actions:** **Back → Forward → Refresh → Copy URL** sit immediately before the search field. They act on the active Chrome tab in the sidebar’s window, including when its page is saved or a different space is selected. Back and Forward use that tab’s own browser history and report when no previous or next page exists. Copy URL writes the current address only when clicked. These actions are disabled when there is no active page.
- **Middle-click to close:** click the middle mouse button on a regular open-tab row to close it without activating it. Chrome-pinned tabs, Arclet pinned pages, and favorites are protected; explicitly closing or unpinning them remains available through the existing controls. Closed regular tabs can be restored as usual.
- **Light, dark, and system appearance** from the settings button. Optionally enable **Settings → Background → Custom background color** and choose a color or enter a six-digit hex value. This main background override persists across windows and restarts, independently of space colors. Disable it or choose **Use theme default** to restore the current theme’s background.
- **Neutral gray interface:** settings, menus, dialogs, primary buttons, and focus outlines use the gray palette below, independently of the selected space. The compact search bar and favorite tiles have no borders and follow the selected space’s tab-area background, including custom colors; their hover states retain that color. Slate spaces use the neutral tab-area color; other palettes and custom backgrounds remain available.
- **Custom space backgrounds:** create or edit a space, enable **Custom background color**, and use the picker or hex input. The color applies to that space’s tab area, search bar, favorite tiles, and selected footer tab in every theme, independently of the main background and icon color. Choose a palette, disable the toggle, or select **Use palette** to return to the existing theme-aware palettes. Changes apply when you save the space and persist across restarts.
- **Native OS typography:** interface text, form controls, and keyboard shortcuts use the operating system’s UI font.
- **Adjustable font size:** choose 90%, 100% (default), 110%, 125%, or 150% in **Settings → Sidebar → Font size**. Text throughout Arclet scales immediately, including tabs, favorites, menus, and settings. The preference applies across windows and survives restarts.
- **Optional search bar:** open Settings at the footer’s right edge and toggle **Show search bar** to show or hide the search field and its page-action buttons. This preference survives restarts and applies to every window. New tab and the search shortcut remain available when the bar is hidden.
- **Optional favorite labels:** use **Settings → Show favorite labels** to show site names or use icons alone. The preference survives restarts; titles remain available in tooltips and accessible names.
- **Favorites per row:** choose 1–8 in **Settings → Sidebar → Favorites per row** (default: 4). Tiles wrap into additional rows, and the favorites area scrolls after reaching 35% of the sidebar height. If you have fewer favorites than the chosen count, they fill the available row. The preference applies across windows and survives restarts.
- **Multiple windows** with independently selected spaces. Tab actions stay within their originating window.
- **Spaces survive Chrome restarts.** When Chrome restores your tabs, Arclet recovers their assignments from a local checkpoint, including separate copies of the same URL.

Deleting a space moves its tabs, folders, and pinned pages into the first remaining space, keeping folder membership. It does not close tabs. Tabs opened by a page inherit their opener’s space; other new tabs use the window’s selected space.

## Import and export

Use **Settings → Import & export** to download your sidebar as JSON or select an Arclet JSON file. Import shows a preview before saving. It merges spaces and folders by exact name, skips existing saved URLs, and appends new items without opening or closing browser tabs. Appearance settings are optional and off by default when importing.

The public **Arclet format v1** covers spaces, favorites, pinned pages, folders, icons, colors, order, and appearance preferences. See the [format guide](docs/import-format.md), [JSON Schema](docs/import-format.schema.json), and [example file](docs/import-example.json). Settings links to the guide on GitHub and includes an offline example download. This is a documented target for future converters; it does not directly parse Arc's internal files.

Export excludes live browser tabs, history, cookies, passwords, and tab-recovery state. All import/export processing happens locally.

## Theme palette

| UI role | Light | Dark |
| --- | --- | --- |
| App background | `#ECEEF0` | `#1B1E23` |
| Sidebar / tab area | `#F5F6F7` | `#23272E` |
| Cards, menus, dialogs | `#FFFFFF` | `#2B3038` |
| Hover background | `#E4E7EB` | `#343A43` |
| Selected tab / space | `#D9DEE5` | `#424A56` |
| Primary text | `#30343B` | `#ECEEF0` |
| Secondary text | `#626973` | `#B0B7C1` |
| Muted icons | `#717985` | `#969CA5` |
| Borders / dividers | `#D1D6DC` | `#3C434D` |
| Primary button | `#30343B` | `#DCE1E7` |
| Text on primary button | `#FFFFFF` | `#23272E` |
| Focus outline | `#626973` | `#B6BEC9` |

Custom main and space backgrounds override only their respective surfaces. Colored space palettes and saved icon colors remain optional; dialogs, menus, primary buttons, and focus outlines keep the neutral theme colors.

## Chrome limitations and persistence

An extension cannot replace Chrome’s browser frame or remove its native horizontal tab strip. This extension runs in Chrome’s native side panel; Chrome supplies its surrounding toolbar and resizing behavior. Spaces filter the sidebar list; tabs in other spaces remain open and visible in Chrome’s native tab strip. Switching a space changes the sidebar list; choose a tab to change the page.

Spaces, favorites, pinned pages, folders, custom icons/colors, and appearance are saved in `chrome.storage.local`. Existing saved pages upgrade without resetting their settings. Arclet also keeps a local checkpoint of tab URLs (including pending navigations), order, pinned status, space assignments, and the selected space in each window. Chrome’s temporary tab and window IDs stay in `chrome.storage.session`; they are never used as persistent identities.

To keep your browsing session across restarts, enable **Settings → On startup → Continue where you left off** in Chrome (`chrome://settings/onStartup`). Arclet matches the restored windows and tabs to the checkpoint, one tab at a time. It handles tabs whose URLs arrive late, duplicate URLs, worker suspension, extension reloads, and window-close events during shutdown. Moving tabs, navigating, and rearranging Chrome’s native tab strip updates the checkpoint even when the panel is closed. Arclet does not reopen pages that Chrome has not restored.

Recovery uses exact URLs, window context, tab order, and pinned status. Copies of the same page in different spaces are matched by their order within a window. Completely indistinguishable windows or duplicate tabs reordered outside Chrome’s saved session can be ambiguous. Unmatched pages use the selected space. The checkpoint retains up to 20 recent missing/closed windows so that shutdown cannot erase the last session; it excludes incognito URLs.

After updating from 0.1, reload the extension at `chrome://extensions` and reopen the sidebar. Assign any tabs whose old session-only assignments were already lost once; assignments saved by 0.2 survive subsequent restarts. The update cannot reconstruct assignments that 0.1 never saved to disk.

The extension does not create isolated cookie profiles for spaces, inject content scripts, automatically archive tabs, or replace the new-tab page. Chrome native pinned tabs are listed as live tabs; Arclet’s saved Pinned pages are managed separately.

## Local preview and development

Node.js 20+ is needed only for the development commands. Nothing needs to be installed with npm.

```sh
npm run preview
```

Open `http://127.0.0.1:4173/sidepanel.html?demo=1`. This explicit preview uses sample tabs and an in-memory browser adapter. It exercises the same controller as the extension, but does not control real Chrome tabs. Reloading the preview resets its sample data. To use another port, set `ARCLET_PORT`.

```sh
npm test          # State, concurrency, navigation, and tab-action regression tests
npm run check    # Manifest, resources, CSP, IDs, and JS syntax
npm run package  # Produces dist/arclet/ and dist/arclet-0.12.0.zip
```

After changing source files, click Reload on the extension’s card at `chrome://extensions`, then close and reopen the panel. There are no remote scripts, fonts, or build tools.

For the restart integration test, set `ARCLET_PLAYWRIGHT` to an installed Playwright package directory and `ARCLET_CHROME` to a Chrome for Testing / Chromium executable, then run `node scripts/restart-smoke.mjs`. It opens a temporary browser profile, assigns duplicate URLs in two real Chrome windows, changes a URL through Chrome itself, closes the browser process, launches it again with the same profile, and checks each restored assignment. It also reloads the panel and removes the profile afterward. The test never uses your regular Chrome profile.

## Source

- `src/background.js` registers Chrome events and configures the toolbar action.
- `src/controller.js` is the single writer for state; commands and browser events are serialized across panels.
- `src/persistence.js` checkpoints windows and recovers tabs one-to-one after a browser restart.
- `src/pinned-order.js` validates and saves mixed pin/folder order and folder membership; older lists migrate in their existing display order.
- `src/pin-drag.js` shares pointer dragging, drop hints, cancellation, scrolling, and live-tab drop destinations.
- `src/favorite-drag.js` adds grid hit testing for favorite ordering, including gaps and wrapped rows.
- `src/model.js` handles defaults, safe URL parsing, colors, and search.
- `src/transfer.js` validates the versioned interchange format, exports saved data, and plans imports before storage is changed.
- `src/sidepanel.js` and `src/sidepanel.css` implement the UI.
- `src/icon-picker.js` shares the searchable icon/color picker across saved pages, folders, and spaces.
- `src/icon-catalog.js` contains Lucide 1.67.0 geometry and search tags; `src/LUCIDE-LICENSE.txt` includes its ISC and inherited Feather MIT notices. Regenerate with `node scripts/vendor-icons.mjs /path/to/unpacked/lucide-static-1.67.0/package`.
- `src/platform.js` connects the panel to Chrome or the explicit demo adapter.
- `icons/mark.svg` is the Folded space icon source, also shown in Settings. Matching PNG variants are bundled for Chrome’s toolbar, extension list, and the preview favicon.

## Permissions and privacy

| Permission | Purpose |
| --- | --- |
| `sidePanel` | Show the sidebar. |
| `tabs` | Read tab titles, URLs, and status to display and organize tabs. |
| `storage` | Save spaces, shortcuts, appearance, and a local tab-recovery checkpoint on this device. |
| `sessions` | Restore a recently closed tab when requested. |
| `favicon` | Read Chrome’s favicon resources without a third-party icon service. |
| `clipboardWrite` | Copy the active tab’s URL when you click Copy URL. Arclet never reads the clipboard. |

No analytics, account, backend, host permissions, or webpage-content access. Opening a URL or submitting a Google search naturally navigates the browser to that service. Removing the extension removes its saved data.

Arclet is an independent project inspired by Arc’s interaction patterns. It is not affiliated with Arc or The Browser Company.
