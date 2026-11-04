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

- **Live vertical tabs** for the current Chrome window. Switch, close, mute, and restore the last closed tab.
- **Spaces** with names, icons, and six color palettes. New spaces use Slate gray by default. The selected footer tab shows its name and connects to a subtly colored folder containing its tabs. The surrounding background stays gray. The selector sits at the footer’s left edge. Add a space with its plus button; right-click a space to edit it.
- **Drag and drop** to reorder tabs, or drop a tab onto a space icon to move it. A tab’s right-click menu also provides a keyboard-accessible way to move it (Shift F10).
- **Favorites** shared by all spaces. Right-click an open tab or pinned page and choose **Add to favorites**. A pinned page can be saved as a favorite even when its browser tab is closed. Hover or right-click a favorite to remove it. Empty favorites sections are hidden.
- **Pinned pages** per space. Right-click an open tab and choose **Pin to this space**. These are durable shortcuts: closing the live tab keeps the saved page. Clicking a saved page focuses an existing matching tab in the space or opens it again. Pages pinned in a space are hidden from that space’s Open tabs list; their underlying Chrome tabs stay open and remain searchable. Unpinning a page makes its live tabs reappear. Right-click a pinned page to favorite, mute, close its live tab, or unpin it.
- **Pinned folders** per space. Right-click a space, **New tab**, or the empty content area and choose **New pinned folder**. Right-click a pinned page → **Move to folder** to file it, move it out, or create a folder containing it. You can also drag a pinned page or open tab onto a folder heading. Drag pinned pages or folder headings to reorder them, including placing folders between loose pins. Drop a page in a folder heading’s center to file it; use its top or bottom edge to insert beside the folder. Drag onto a page to insert before or after it, or use the “Drop here outside folders” area to unfile a page. Empty folder areas accept drops too. Insertion lines and folder highlights show the destination. Escape cancels a drag; long lists scroll near their edges. Click a folder to collapse or expand it; membership, order, and collapse state survive restarts. Right-click a folder to rename it, change its icon, or remove the folder while keeping its pages. Folders are one level deep. For keyboard ordering, focus a pin or folder and press Alt+↑ / Alt+↓, or use its right-click menu’s Move up / Move down actions.
- **Custom icons and colors** for spaces, pinned folders, pinned pages, and favorites. Choose from 2,019 searchable [Lucide](https://lucide.dev/) outline icons, with preset colors, a custom color picker, or an automatic theme color. Right-click saved pages → **Customize icon**; **Use site icon** restores the favicon. Edit a space or folder to choose its icon separately from the space’s background palette. The entire library works offline.
- **A simpler tab list:** no Open tabs heading or count bar. Right-click **New tab** or the selected space to **Restore last closed tab**.
- **Search and navigation** with **⌘ K / Ctrl K**, while the sidebar has keyboard focus. Search tabs across spaces, switch with arrow keys and Enter, or click the bottom result to open a URL or Google search. Bare domains and localhost addresses work.
- **Light, dark, and system appearance** from the settings button.
- **Native OS typography:** interface text, form controls, and keyboard shortcuts use the operating system’s UI font.
- **Optional search bar:** open Settings at the footer’s right edge and toggle **Show search bar**. This preference survives restarts and applies to every window. New tab and the search shortcut remain available when the bar is hidden.
- **Optional favorite labels:** use **Settings → Show favorite labels** to show site names or use icons alone. The preference survives restarts; titles remain available in tooltips and accessible names.
- **Multiple windows** with independently selected spaces. Tab actions stay within their originating window.
- **Spaces survive Chrome restarts.** When Chrome restores your tabs, Arclet recovers their assignments from a local checkpoint, including separate copies of the same URL.

Deleting a space moves its tabs, folders, and pinned pages into the first remaining space, keeping folder membership. It does not close tabs. Tabs opened by a page inherit their opener’s space; other new tabs use the window’s selected space.

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
npm run package  # Produces dist/arclet/ and dist/arclet-0.4.0.zip
```

After changing source files, click Reload on the extension’s card at `chrome://extensions`, then close and reopen the panel. There are no remote scripts, fonts, or build tools.

For the restart integration test, set `ARCLET_PLAYWRIGHT` to an installed Playwright package directory and `ARCLET_CHROME` to a Chrome for Testing / Chromium executable, then run `node scripts/restart-smoke.mjs`. It opens a temporary browser profile, assigns duplicate URLs in two real Chrome windows, changes a URL through Chrome itself, closes the browser process, launches it again with the same profile, and checks each restored assignment. It also reloads the panel and removes the profile afterward. The test never uses your regular Chrome profile.

## Source

- `src/background.js` registers Chrome events and configures the toolbar action.
- `src/controller.js` is the single writer for state; commands and browser events are serialized across panels.
- `src/persistence.js` checkpoints windows and recovers tabs one-to-one after a browser restart.
- `src/pinned-order.js` validates and saves mixed pin/folder order and folder membership; older lists migrate in their existing display order.
- `src/pin-drag.js` handles pointer dragging, drop hints, cancellation, scrolling, and live-tab drop destinations.
- `src/model.js` handles defaults, safe URL parsing, colors, and search.
- `src/sidepanel.js` and `src/sidepanel.css` implement the UI.
- `src/icon-picker.js` shares the searchable icon/color picker across saved pages, folders, and spaces.
- `src/icon-catalog.js` contains Lucide 1.67.0 geometry and search tags; `src/LUCIDE-LICENSE.txt` includes its ISC and inherited Feather MIT notices. Regenerate with `node scripts/vendor-icons.mjs /path/to/unpacked/lucide-static-1.67.0/package`.
- `src/platform.js` connects the panel to Chrome or the explicit demo adapter.
- `icons/mark.svg` is the original icon source; PNG variants are bundled for Chrome.

## Permissions and privacy

| Permission | Purpose |
| --- | --- |
| `sidePanel` | Show the sidebar. |
| `tabs` | Read tab titles, URLs, and status to display and organize tabs. |
| `storage` | Save spaces, shortcuts, appearance, and a local tab-recovery checkpoint on this device. |
| `sessions` | Restore a recently closed tab when requested. |
| `favicon` | Read Chrome’s favicon resources without a third-party icon service. |

No analytics, account, backend, host permissions, or webpage-content access. Opening a URL or submitting a Google search naturally navigates the browser to that service. Removing the extension removes its saved data.

Arclet is an independent project inspired by Arc’s interaction patterns. It is not affiliated with Arc or The Browser Company.
