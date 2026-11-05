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

## Duplicate, rename, and control favorites

Duplicate is available on favorites, pinned pages, and regular tabs. Favorites produce regular browser tabs; pins produce an independently owned pinned item immediately after the original in its folder/space; regular tabs remain regular. Open saved items use their running instance’s current page rather than their saved root. Closed items use their saved URL. Native duplication preserves Chrome’s history where an instance exists. Matching addresses never merge these independent pins.

Edit updates a pin/favorite’s saved name, icon, and icon color together without changing its root, running page, identity, folder, or order. Canceling the editor discards all draft changes. Invalid edits leave the saved item intact. Favorite labels use the saved name. Duplicate pins retain their saved name and appearance; they can then be renamed independently.

Controls-only navigation hides the URL launcher, keeps an empty center, and puts Copy URL opposite Back/Forward/Refresh/Home/Email/Calendar. Home, Email, and Calendar are separate favorites configured through individual HTTP/HTTPS URL fields in Settings, each with a dedicated owned instance per window. Unconfigured icons are hidden. The three destinations share one settings card, visible only in controls-only mode, with the toolbar icon beside each URL. URLs save when their field loses focus; invalid or rejected edits remain visible for correction. Clicking resumes that instance; its context menu can return to its saved URL, duplicate it as a regular tab, rename it, or close it. Changing or clearing a destination releases only that favorite’s old instances as regular tabs without closing them. Destinations and saved names persist across restart, optional settings import/export, and Chrome Sync; they count toward storage capacity. Keyboard search remains available even when the URL launcher or entire toolbar is hidden.

## Other tab operations

The controls between pinned and regular tabs share one row: New tab and Clean on the left, folder creation/collapse/expand on the right. An S-shaped divider passes above the tab controls and below the folder controls to associate each group with its section. Context menus separate editing, organization, session actions, and removal/bulk-close actions. Move to space opens a separate destination menu with Back navigation, rather than listing every space in the main menu.

Associated instances stay out of the regular tab section regardless of their current address. Independent duplicates remain visible. The broom, regular-tab bulk close, and middle-click protections use ownership, including for instances away from home. Native Chrome-pinned tab protection remains unchanged.

Search includes current pages and identifies their saved owner. Activating a search result resumes that instance. Loading and audio status are shown on the saved item; mute/close actions target its actual running instance.

## Restart, restore, and migration

If Chrome restores an owned tab, Arclet reconnects it where the saved tab/window context is unambiguous, preserving its current page. Otherwise the saved item is closed and the browser tab stays visible as regular. Arclet does not reopen all saved items on startup and does not rebuild browsing histories itself.

Arclet's Restore last closed tab requests the optional `sessions` permission on first use; denying it leaves tabs unchanged. Once granted, it restores Chrome's previous session rather than opening the saved home. Ownership can be reconnected only for closes recorded while this permission was available. It reconnects an owner only when the recently closed session can be identified and the destination has no other instance. A conflicting restored tab remains regular. Native Chrome Undo Close may not expose enough evidence to prove saved ownership; an uncertain restored tab remains regular rather than being attached by URL alone.

Legacy saved URLs are adopted only where ownership is clear. Already-navigated legacy tabs cannot be assigned a saved owner reliably and remain regular. After migration, revisiting a saved URL does not automatically turn a regular tab into an owned instance. Imported saved items similarly remain closed until opened; importing does not take over live tabs.

Closing a window during browser shutdown preserves the ownership checkpoint for Chrome restoration. Worker suspension and tab replacement retain live ownership. Removing a saved item clears both current and recoverable ownership for that item. Arclet is disabled in incognito windows and rejects saving private tabs. Legacy private ownership remains excluded from the on-disk checkpoint. The restart checkpoint is capped at 1 MiB and omits addresses longer than 8,192 characters, so omitted instances cannot be reconnected by that checkpoint.

## Home URL and redirect detection

Home comparison uses the full normalized URL, including meaningful query parameters and fragments. Different domains do not break ownership. A verified automatic redirect from home counts as home too; saved URLs are never silently rewritten.

Arclet learns a destination only for the associated running instance, using Chrome's top-level navigation events and redirect qualifiers. HTTP redirects from the saved URL (or a verified home destination) count as home. JavaScript/meta-refresh redirects also count when they occur during the initial home load, before the document is ready. An ordinary link, typed child URL, form submission, Back/Forward, or single-page route change does not teach a new home destination. Redirects originating from an Away page do not teach one either. Returning to a previously verified home destination clears the arrow.

Verified destinations survive worker suspension, tab replacement and unambiguous Chrome session restoration with their owner. They are not shared across instances or included in import/export. Closing and normally reopening starts fresh at the saved URL; Return to saved URL relearns its current redirect destination and discards obsolete destinations. Private-window destinations remain in session storage only.

Detection requires the `webNavigation` permission, without host permissions or reading webpage content. Existing redirected instances need a return to the saved URL (or close/reopen) to establish evidence. Late client-side redirects and ambiguous/interrupted cross-process event sequences conservatively remain Away; Arclet does not guess based on hostname similarity or rewrite saved addresses.

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
11. Open a saved URL that automatically redirects: its final home has no Away arrow. Follow a child link, including one that redirects: show Away. Back to verified home clears it.
12. Reset/reopen a redirected saved item, restore its identified session, and verify independent instances do not inherit its destinations.

## Feasibility basis

Chrome exposes tab navigation, activation, closure, replacement, and native Back/Forward actions. The core is achievable using Arclet's existing browser access. Conservative ownership recovery is necessary because browser session identifiers are temporary and restored duplicates can be ambiguous. Arclet continues to rely on Chrome for browsing-history restoration.

- [Chrome tabs reference](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome session restoration](https://developer.chrome.com/docs/extensions/reference/api/sessions)
- [Arc commands distinguish close, reset, and unpin](https://start.arc.net/command-bar-actions)
- [Chrome navigation events and redirect qualifiers](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)
