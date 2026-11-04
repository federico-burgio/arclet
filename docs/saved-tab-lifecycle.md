# Saved tab lifecycle functional specification

Status: first version, agreed November 4, 2026.

A favorite or pinned page has a permanent saved home URL and may have a running browser tab. The running tab stays associated with the saved item as it navigates. Chrome retains that instance's Back/Forward history. Closing the running tab never removes the saved item.

## States and actions

| State | Presentation | Clicking the item |
| --- | --- | --- |
| Closed | Saved name/icon; no status badge | Reuse an eligible unassociated tab at home, or open home |
| Open at home | Saved name/icon; no status badge | Activate the associated tab |
| Open away from home | Additional small away glyph; tooltip exposes current title/address | Activate the current page without resetting it |

Active selection, loading, audio, and discarded status are independent of home/away state. Saved names, custom icons, colors, folder membership, and order remain unchanged during navigation. Returning home through Back clears the away indicator; Forward restores it when appropriate. No selection accent border is reintroduced.

- **Close tab** closes only this item's running instance in the requesting window. The next normal opening starts at home. A cancelled browser close keeps the item open.
- **Return to saved URL** navigates the existing instance home without changing the saved URL or recreating its history.
- **Unpin page / Remove favorite**, available through the context menu, removes the saved item and leaves its running instance open as a regular tab.
- A pinned row's close icon means Close tab and appears only while open. Closed pins have no removal button.
- Favorites retain their design without an overlaid close button. Their context menu exposes Close tab and, while away, Return to saved URL.

## Ownership and navigation

Each browser tab has at most one saved owner. Each saved item has at most one running instance per window. Pins belong to their space. Favorites reuse their instance across spaces within a window without unexpectedly selecting another space. Different windows retain independent instances and histories.

Navigation within an instance preserves ownership, including address-bar changes, different domains, redirects, Back/Forward, and single-page application routes. A separate tab opened by a link, duplication, or an explicit new-tab action is a regular tab. Identical addresses do not merge sessions or hide independent duplicates.

Saving an ordinary tab associates it immediately. Saving another item from a tab that already has an owner leaves its existing owner intact; the additional saved entry starts closed. Identical URLs in multiple saved entries do not imply shared ownership. Opening one must not steal another's instance.

Opening a closed saved item can adopt an unassociated exact-home tab in the same window (and same space for a pin). Prefer an active candidate; otherwise adopt only a unique candidate. Ambiguous candidates remain regular and a new owned tab opens. Repeated clicks resume the same instance.

Reordering saved items, changing appearance, and filing pins into folders preserve their instances. An associated pin remains assigned to its saved space. Moving a running tab to a different space through a tab-only action requires unpinning it first; it does not silently move or remove the pin. Moving a tab to another window transfers ownership unless that destination already has an instance for the saved item; in that case the arriving tab stays open as a regular tab.

## Other tab operations

Associated instances stay out of the regular tab section regardless of their current address. Independent duplicates remain visible. The broom, regular-tab bulk close, and middle-click protections use ownership, including for instances away from home. Native Chrome-pinned tab protection remains unchanged.

Search includes current pages and identifies their saved owner. Activating a search result resumes that instance. Loading and audio status are shown on the saved item; mute/close actions target its actual running instance.

## Restart, restore, and migration

If Chrome restores an owned tab, Arclet reconnects it where the saved tab/window context is unambiguous, preserving its current page. Otherwise the saved item is closed and the browser tab stays visible as regular. Arclet does not reopen all saved items on startup and does not rebuild browsing histories itself.

Arclet's Restore last closed tab restores Chrome's previous session rather than opening the saved home. It reconnects an owner only when the recently closed session can be identified and the destination has no other instance. A conflicting restored tab remains regular. Native Chrome Undo Close may not expose enough evidence to prove saved ownership; an uncertain restored tab remains regular rather than being attached by URL alone.

Legacy saved URLs are adopted only where ownership is clear. Already-navigated legacy tabs cannot be assigned a saved owner reliably and remain regular. After migration, revisiting a saved URL does not automatically turn a regular tab into an owned instance. Imported saved items similarly remain closed until opened; importing does not take over live tabs.

Closing a window during browser shutdown preserves the ownership checkpoint for Chrome restoration. Worker suspension and tab replacement retain live ownership. Removing a saved item clears both current and recoverable ownership for that item. Incognito tab URLs and ownership metadata are excluded from the on-disk checkpoint; explicitly saving a page still saves its home URL.

## Home URL and first-version limits

Home comparison uses the full normalized URL, including meaningful query parameters and fragments. Different domains do not break ownership. Initial automatic redirects always preserve ownership but may show Away if their destination differs from the saved URL. Treating a verified redirect destination as a home alias is deferred until it can be distinguished reliably from user navigation; saved URLs are never silently rewritten.

The first version excludes Peek, domain-based link interception, automatically changing saved URLs, copying history stacks, automatic archiving, and changes to Chrome's native tab strip.

## Acceptance scenarios

1. Save a root, navigate to multiple child pages in the same browser tab, and observe one saved item and no duplicate regular row.
2. Switch away and click the saved item: return to the current child page in the same instance with native Back/Forward history intact.
3. Back to home clears Away; Forward to the child restores it.
4. Close a pin with its inline close icon: retain the pin, show Closed, and reopen home on the next click.
5. Remove a pin/favorite through its context menu: preserve its running browser tab and show it as regular.
6. Close through Chrome, then normally open the saved item: start at home. Arclet Restore last closed tab may instead restore the prior child session when identified.
7. Keep independent duplicate tabs visible and leave owned instances untouched by regular-tab cleanup after navigation.
8. Reuse favorites across spaces, keep pins scoped, and never close/focus an instance in another window accidentally.
9. Restore known associations across restarts; ambiguous duplicates or windows remain visible regular tabs.
10. Preserve ownership through worker suspension, tab replacement, folder operations, and browser tab moves without losing pages.

## Feasibility basis

Chrome exposes tab navigation, activation, closure, replacement, and native Back/Forward actions. The core is achievable using Arclet's existing browser access. Conservative ownership recovery is necessary because browser session identifiers are temporary and restored duplicates can be ambiguous. Arclet continues to rely on Chrome for browsing-history restoration.

- [Chrome tabs reference](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome session restoration](https://developer.chrome.com/docs/extensions/reference/api/sessions)
- [Arc commands distinguish close, reset, and unpin](https://start.arc.net/command-bar-actions)
