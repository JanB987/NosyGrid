# Detailed usage

See the [README](../README.md) for installation, screenshots and a quick start.

## Ordering and writes

- Only a real numeric frontmatter property can control manual order. File and formula properties are read-only and cannot be selected as the ordering property. Text values such as `high` or `"1"` disable reordering rather than being overwritten.
- A successful move assigns the visible group's notes consecutive values 1…N. Ascending gives the first row 1; descending gives the first row N. Only changed values are written. Merely opening a view never edits notes.
- Empty values appear after numbered notes. Equal values are ordered by file path until the next move gives every row a distinct rank.
- Grouped Bases are supported. Reorder within a group; crossing groups is disabled. Each group has its own 1…N sequence.
- Only notes returned by the Base query are involved. Notes outside the filters or row limit are untouched. Because filtering/limits are applied by Bases before the view receives data, use an unlimited Base when you want a vault-wide or project-wide sequence. Hidden notes can retain duplicate ranks.
- The view's ordering property and direction take precedence over the normal Bases Sort menu. Avoid a Base row limit that selects a different subset via other sorting rules.
- Writes use Obsidian's `processFrontMatter`, preserving note content and other properties. Obsidian may normalize YAML formatting. Fresh-value checks prevent overwriting conflicting rank edits; completed writes are rolled back if a later write fails. Obsidian has no multi-file atomic transaction: a crash or sync interruption can still leave a partial operation.
- **Undo reorder** and the **NosyGrid: Undo last row reorder** command restore the latest successful move in this app session. Undo checks for later rank edits and refuses to overwrite conflicts. History is cleared on plugin reload. This is separate from the editor's Ctrl+Z history.

## Editing cells (v0.8.0)

- **Click and type directly in the cell.** There is no editor panel, Save/Cancel button row, or type selector. Text cells preserve their dimensions during editing. List cells automatically expand and provide one editable input per item, with an × remove control and an empty add-item row.
- **The property defines the type for every row.** The plugin reads Obsidian's saved property definitions from the vault configuration's `types.json` using the public vault adapter. Change types using Obsidian's Properties interface. If a property has no saved definition, the plugin infers one type across the vault, with list defaults for `tags`, `aliases`, and `cssclasses`. The manual-order property stays numeric. Definitions are reloaded before opening an editor; the plugin never changes them.
- **Text, numbers, checkboxes, dates, date/time, lists, and structured YAML** are supported. All rows of a property use the same editor, including empty cells and cells containing an inconsistent stored value.
- In **Text and other scalar cells**, **Enter** saves, **Escape** cancels, **Tab / Shift+Tab** saves and edits the next / previous cell. Shift+Enter inserts a line in text/YAML editors. In **List cells**, Enter confirms a filled item and focuses a new empty item; Enter in an empty item saves and leaves the cell. Leaving either editor also saves. Invalid input or a conflicting edit keeps the draft open and shows an error.
- **Checkboxes** toggle directly with one click. **Lists** use one input per item, so commas inside an item remain intact. Use `[[Note name]]` for links.
- **Delete the value and leave the cell** to remove a non-checkbox property. Merely focusing and leaving a cell never modifies, normalizes, or deletes its value. Explicit YAML `null`, `false`, and `0` remain values. Text such as `001` remains text when its property is Text.
- **File name / basename, path, and folder** cells can rename or move files using `FileManager.renameFile`, with link updates following Obsidian's preferences. Paths are vault-relative, destination folders must exist, and the file extension must stay unchanged. Existing files are never overwritten. The file-name editor includes the extension; the basename editor does not.
- **Undo edit** restores up to 50 cell edits from the current session, separately from **Undo reorder**. Undo refuses to overwrite later changes. The commands are also available in the command palette. Session history is cleared on reload.
- **Arrow keys** move focus among editable cells; Enter or F2 opens the editor. Clicking a rendered link opens it; click surrounding cell space to edit its value.
- Drafts remain open during Bases query updates. Saving uses a fresh frontmatter value check inside `processFrontMatter`, preserving unrelated properties. Reordering is paused while a cell editor is open. Filters and grouping take effect after the editor closes, so a saved row can move or disappear as expected.

## Lists and row heights

- List properties show one bulleted item per line. Each item retains its text and individually interactive links, including multiple links within one item.
- Rows default to **48 pixels** outside editing. Items beyond the available cell height are clipped. Selecting a List cell automatically expands the row to show all existing items and the empty add-item input. Adding more item rows while editing grows the row as needed.
- A small chevron bar appears at the bottom of an overflowing List cell. Click it to expand that row until all items in that cell fit. Rows below move down. Click the upward chevron to restore the default height.
- If another List cell in the same row needs more space, its downward chevron can expand the row further. Fully visible lists in an expanded row offer the collapse control.
- Click an existing item to place the cursor where you clicked. Click the **×** after an item to remove that particular occurrence, even if duplicate values exist. Confirmed removals save immediately.
- **Enter in a filled item** confirms the current values and focuses an empty item immediately below. Typing there and pressing Enter adds the item and opens another empty input. **Enter in an empty item** saves any remaining changes and leaves the cell. Empty add rows are never stored as list items. Pasted lines become separate items.
- **Escape** cancels edits since the last confirmation and leaves the cell; previously confirmed additions/removals remain saved. **Undo edit** can restore a confirmed change after leaving the cell. A failed/conflicting save keeps the draft and shows an error without overwriting the note.
- The expand/collapse control remains usable while editing and does not save, discard, or blur the draft. Up/Down can move between item inputs at their text boundaries; Tab/Shift+Tab saves and moves to another cell.
- Non-default heights are stored directly in the **Base view** using `BasesViewConfig.set`, in a `manualRowHeights` map keyed by note path. Reopening the Base restores those heights, and reordering keeps each height attached to its note. File renames made through the table migrate the saved key. Different views keep independent height settings.
- Collapsing removes that note's stored height. When all rows are collapsed, the map is removed. Row presentation changes never modify note properties. Saved heights are restored as pixels; if a list or column width later changes, the chevron can expand it further as needed.

## Internal links and autocomplete

- Type **`[[`** in a **Text or List** cell to search vault files and note aliases. The search narrows as you type. The popup is outside the table layout, so cell dimensions stay fixed.
- **Up/Down** selects a result; **Enter**, **Tab**, or a mouse click inserts it. Choosing a result does not save. The next Enter follows the field's normal behavior: save a Text cell, or confirm a List item and focus a new input. Tab saves and moves to another cell. **Escape** dismisses the popup first; a second Escape cancels unconfirmed edits.
- Each token is independent. For example, a Text value can contain `See [[First note]] and [[Second note|Label]]`, and a single List item can contain the same combination. Other list items and surrounding text are preserved. Every item input supports its own autocomplete.
- Duplicate note names use Obsidian's source-relative link generation. Existing display aliases are preserved. Search note aliases to insert a link with that display alias. Type `[[Note#` for heading suggestions, or `[[Note#^` for block suggestions, using Obsidian's cached metadata.
- If a file search has no results, selecting the new-note suggestion inserts an unresolved link. It does not create a note during editing; opening the link delegates that behavior to Obsidian.
- Saved links render separately using the public **`LinkValue.parseFromString` / `Value.renderTo`** API, even when surrounded by prose or other links. Click to open, Ctrl/Cmd-click or middle-click for a new pane/tab, hover for Page preview according to Obsidian's source settings, or right-click for the native link menu. Click surrounding cell space or use F2 to edit a value that contains links.
- While editing **Text or List** cells, **Ctrl/Cmd-click** a complete `[[link]]` to open it in another pane/tab. This works for multiple links, display aliases and subpaths. Ordinary clicks remain cursor-placement actions, and selected text is not treated as a link click. Opening a link does not explicitly save or alter the draft; leaving the cell still follows the normal save-on-blur behavior.
- Link search uses public `prepareFuzzySearch`, `Vault.getFiles`, `MetadataCache.fileToLinktext`, `getFirstLinkpathDest`, and `getFileCache`. Link interactions use `Workspace.openLinkText`, `hover-link`, and `handleLinkContextMenu`. The public `AbstractInputSuggest` supports inputs/contenteditable divs but not multiline textareas; this plugin uses a small popup for its textarea editor without relying on private suggestion classes.

## Dragging note links between cells

- Drag an individual rendered note link from a Text or List cell onto another **Text or List** cell. File-name links can also be copied this way. A highlighted cell indicates an accepted destination.
- Dropping onto **Text** appends the link, with a separating space when needed. Dropping onto **List** appends a separate list item. Existing values remain intact, and the source link is always copied, never moved. Repeated drops may add duplicates.
- Aliases, heading/block subpaths, and linked-file identity are preserved. Links to existing files use Obsidian's public source-relative resolution and link-generation APIs to remain correct when copied between different folders or notes. Explicit relative unresolved paths are rebased; dropping an unresolved link does not create a note.
- You can select a complete `[[wikilink]]` inside an editor and drag that selection to another cell. Other selected text is not handled as a note-link drag.
- Dropping into an open editor preserves its current draft. Text drafts are saved with the added link; List drafts receive a new item and stay editable. A different open editor is saved before the destination is updated. Conflicting edits are rejected rather than overwritten. **Undo edit** restores the destination change after leaving any active editor.
- Numeric, checkbox, date, formula, file-name/path, and manual-order cells do not accept link drops. Link dragging is separate from the grip used to reorder rows and never changes numeric row ranks.

## Selecting multiple cells

- Press the left mouse button in a cell's text or empty space, hold it, and move across the table to select a rectangular range. Release to keep the selection. Dragging a range does not open editors or expand List cells.
- A normal click still edits the cell. Start selection outside links, checkboxes, buttons and active inputs; these retain their existing link-drag, toggle, row-reorder and text-editing behavior.
- **Shift-click** extends the range from its starting cell. **Shift+Arrow keys** extend it from the keyboard. **Escape** clears the selection when outside an editor. Clicking outside the table view also clears it.
- Selection works across grouped tables and includes read-only/formula cells. At the viewport edges, the table scrolls horizontally and vertically to extend the range to cells off screen.
- Selected cells follow their note/property identities through a view refresh. Filtered-out cells are removed from the selection. Selection is temporary UI state; it is not saved into notes or the Base. Opening an editor selects that individual cell.

## Copying selected cells

- Select a cell or range and press **Ctrl+C / Cmd+C**. Copy includes complete values, all hidden list items, raw `[[wikilinks]]`, and read-only formula results. Copy does not save or expand cells.
- Ranges copy as tab-separated columns and newline-separated rows. Cells containing tabs, newlines or double quotes use spreadsheet-style quoting, so multiline Text and List values can be pasted back as complete cells.
- With only a cursor inside an editor, copy includes the whole cell's current draft. Highlighting text inside an editor keeps normal copying of that highlighted text.

## Pasting into selected cells

- Select a range, release the mouse button, and press **Ctrl+V / Cmd+V**. The clipboard's values **replace** the selected cells' contents. The plugin uses the normal paste event and does not read the clipboard in the background.
- **One clipboard cell fills the whole selection.** Tab-separated columns and newline-separated rows map from the selection's top-left cell, regardless of drag direction. A smaller grid repeats when its row/column counts divide the selected range exactly. Otherwise the paste is rejected without truncation or writing outside the selection.
- Spreadsheet-style quoted fields support embedded tabs/newlines and escaped double quotes. Empty fields remove note-property keys. Text literals such as `001` and `false` remain text in Text properties; Number fields require finite numeric values, Checkbox accepts true/false, yes/no, or 1/0, and Date/Date & time fields use the existing ISO format validation.
- List cells receive a new list instead of appending: use one item per line inside a quoted clipboard field, a single item, or an inline array such as `[one, two]`. `[[Note links]]` remain links, and all existing list items are replaced.
- Writable filename, basename, folder and path cells can also be pasted. Filename values may omit the current file extension. Destinations must be unique, unoccupied and in existing folders. Select only one file-name/path/folder column per row for an operation. Formula results and computed file properties remain read-only; including them rejects the paste.
- Every target is validated before writing. Note properties are written once per note using `processFrontMatter`, with fresh-value conflict checks. If a later write fails, completed writes are rolled back where they can still be safely restored; any recovery conflicts are reported. Multi-file changes cannot be made crash-atomic by the public Obsidian API.
- The entire paste is one **Undo edit** operation, including file renames. Undo checks for later changes before writing. Selection stays attached to the affected note/property identities, and saved row heights follow renames.
- Ctrl+V replaces the entire selected cell even with an inline editor open. A single cell receives all clipboard rows; List properties receive one item per line.

## Current scope

This is an independently rendered table using the public Bases API, not a subclass of Obsidian's private native table. It supports Bases filtering, visible columns, friendly property names, grouping, rich property rendering, inline editing, note links, rectangular cell selection/paste, horizontal scrolling, and column resizing. Formula values and computed file properties (size, extension, timestamps, etc.) are read-only. Native table summaries and persistent column widths are not implemented. Desktop drag-and-drop is supported; the grip's movement menu is the alternative on touch devices. Very large result sets are not virtualized.

The public API exposes `BasesEntry.getValue` and `Value.renderTo`, but no property setter or native cell-editor factory. Note edits therefore use `FileManager.processFrontMatter`; renames use `FileManager.renameFile`. No private Obsidian editor classes are used.

## Development


```sh
npm ci
npm run typecheck
npm test
npm run build
```

Copy `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` into the installed plugin folder, then reload the plugin or Obsidian. Do not copy node_modules into the vault.

The browser layout test uses installed Edge or Chrome on Windows, or the executable specified by `OBSIDIAN_TEST_BROWSER`. It skips if no browser is available. The test checks actual cell dimensions for text, number, date, datetime, list, and YAML editors while focusing, typing, and cancelling.

API reference: [Build a Bases view](https://docs.obsidian.md/plugins/guides/bases-view) and [official Obsidian type definitions](https://github.com/obsidianmd/obsidian-api).

## Selecting entries inside a List cell

Click a List cell to open its item editor. Shift-click an item to select a range from the last clicked item; Shift+Up/Down extends an item range from the keyboard. Drag from one item vertically across other items to select them. Dragging within one textarea keeps normal text selection. Ctrl/Cmd-click a bullet or item margin toggles an individual item; Ctrl/Cmd-click on link text still opens the link.

Selected entries are highlighted. Ctrl/Cmd+A while an item selection is active selects all populated entries, and Ctrl/Cmd+C copies selected entries in list order. Escape clears item selection before closing the editor on a subsequent press. A plain click returns to normal editing. Selection alone does not change frontmatter. Pasting continues to replace the complete cell as requested.

## Horizontal row groups and nested grouping

Open Obsidian's **Group** toolbar button. Below the native **Group by** row, use **Nested group by → Add group by** to add further properties. The native grouping property stays outermost; additional properties nest in their listed order. Each added rule has an A → Z / Z → A direction, an up arrow to change its nesting order, and a remove button. Properties do not have to be visible columns. Notes with no grouping value appear under **No value**. List properties group by the complete ordered list, so a note appears once. Existing nested settings from the previous separate Groups menu are retained.

Group headers sit above their rows and show a note count. Click a header, or focus it and press Enter/Space, to collapse or expand it. Parent collapse hides all child groups. Group rules, collapsed states and previously shown group paths are stored in this Base view (`manualGroups`, `manualCollapsedGroups`, `manualKnownGroups`) and restored on reopen. Grouping and collapse alone do not write note frontmatter. Existing custom row heights remain saved.

The public Bases API provides a single native grouping level and no extension point for the built-in Group menu. A small DOM adapter adds the nested controls to the native popup while this view is active; it uses the observed Obsidian 1.15 menu structure and does not call private controller methods. Settings are saved through public BasesViewConfig.set. Native groups retain their order/visibility and become collapsible. The separate **Groups** button remains a fallback in hosts without a native Bases toolbar. DOM integration may need adjustment if Obsidian changes its menu structure.

Manual row ordering applies within the innermost visible group. Rows can also be moved between groups using the grips; the move writes their grouping properties as described below. Group headers are excluded from cell selection/copy/paste. Collapsed notes are excluded from the current cell selection. The view continues to apply Bases filters before grouping.

Group headers display aliased note links using Obsidian's public LinkValue renderer (and the native Value renderer for evaluated Bases values). Links retain source-relative opening, Ctrl/Cmd-click, middle-click, keyboard activation, hover previews and the native context menu. Clicking a link does not toggle the group; click the chevron or surrounding header space to expand/collapse it. This also applies to nested groups and multiple links in list-valued group keys.

## Selecting and moving rows between groups

- Press a row's grip to select it immediately, then drag to reorder or move it. Ctrl/Cmd-click grips to toggle individual rows, or Shift-click a second grip to select the visible range from the anchor. Dragging a selected grip preserves the selected block. Pressing an unselected grip without modifiers replaces the selection. Clicking a cell, empty space or another control clears row selection and performs that control's normal action. Selection circles and the header checkbox have been removed. Right-click a grip for Move up/down; Alt+Up/Down continues to move a focused row. Row selection is separate from cell and list-item selection.
- Drag any selected row's grip to move the selected rows together, in their visible order. Dragging an unselected grip moves just that row. Drop on a **group header**, including a collapsed header, to set that group's property and all ancestor grouping properties. Deeper grouping properties and existing numeric ranks stay unchanged for header drops. The collapsed state is retained.
- Drop above/below a row in another group to change membership and insert at that position. Destination ranks are rewritten in the configured A → Z / Z → A direction. If the ordering property itself is a grouping property, that grouping value takes precedence over positional ranking. Single-row reordering within the same group keeps the existing **Undo reorder** behavior.
- Drops into **No value** remove the corresponding note property. Numbers, booleans and list values keep their types. Note links retain target identity, aliases and heading/block subpaths when rebased for another folder. Equivalent links with different aliases or source-relative spelling share a custom group; reordering within that group preserves each note's existing alias.
- Formula results and computed file properties cannot be assigned. A move within the same computed parent may still change writable child properties. Writable folder/name/path groups use the existing file-renaming checks. The native first grouping property is read through a small, isolated, read-only compatibility accessor because the public Bases API does not expose it; if it cannot be identified, cross-native-group moves are rejected without guessing.
- Group moves and multi-row reorders are one **Undo edit** operation. All changes are preflighted, each note's frontmatter is updated once, and failures roll back earlier writes when no conflicting external edits prevent recovery. Changing a destination during a move or refreshing the table invalidates the move. Selection follows notes through refreshes and renames; notes hidden by collapse/filtering leave the selection. Filters may hide a moved note after its properties change.

## Keeping empty groups available

A previously shown group stays visible with a **0** count when it becomes empty in this Base but another Markdown note in the vault still has the group's value. Empty headers remain expandable/collapsible and accept row drops, so files can be moved back. Supporting notes outside the Base are only used to verify values; they are never added to the table or changed by a drop.

Nested paths are verified as a complete combination on one vault note. A surviving parent value alone keeps the parent header, without inventing unseen child groups. Previously shown paths are remembered in this view and restored after reopening. Unrelated vault values that have never appeared in this view are not added. Headers disappear when their last supporting vault occurrence is changed or deleted; metadata changes trigger a debounced availability refresh.

Retention can verify note properties and supported file metadata (name, basename, path, folder, extension, size). Formula results outside the Base cannot be evaluated through the public API and are not retained without evidence. Changing grouping properties or native group visibility starts a new history, so deliberately hidden native groups are not brought back.

## Vertical groups with tables

Each grouping property can use **Horizontal** or **Vertical** layout. In Obsidian's **Group** popup, choose the layout beside each additional grouping property. **Primary group layout** controls the native first **Group by** property; it is also available in the view's configuration. Existing groups default to Horizontal.

Horizontal groups remain stacked sections above rows. Vertical groups appear side by side, like board columns, with a table showing the same chosen Bases properties in each container. Each level can use a different layout: for example, vertical Project groups containing horizontal Status groups, horizontal Projects containing vertical Status groups, or nested vertical splits. Scroll the board sideways to reach more columns; wide tables and nested splits can scroll within their containing column. Column table scroll positions survive edit-driven refreshes.

Headers retain aliases, clickable Obsidian links, counts and collapse controls. Empty retained columns keep their chosen table headers and accept row drops. Drag selected rows to another column's header, its open background, or a specific row to change grouping values; **Undo edit** restores a move. Nested drops apply the destination's ancestor values as before. Layout changes are saved in this Base view, preserve collapsed/empty group state, and do not change note frontmatter.

Cell range selection and keyboard navigation stay within the originating board column; horizontal subgroups in that same column can share a range. Shift-click in another board column starts a new cell range there. Ctrl/Cmd-click row grips to select notes across columns for bulk moves. The per-property setting is stored as `layout: vertical` in `manualGroups`; `manualNativeGroupLayout` stores the primary native grouping layout.

## Resizing and fully collapsing vertical groups

Drag the edge on the right of an expanded vertical group to change its width (240–2400 px). Vertical groups with the same grouping property and value share a width across horizontal parents. For example, resizing Status: Ready under one project also resizes Ready under the other projects, while Waiting keeps its separate width. Matching uses values, not column positions, and aliases for the same linked note match. The table scrolls inside a narrow column; height continues to follow the contents. All visible matches preview together during dragging, and the shared width is saved when the drag ends. Focus the resize edge and use Left/Right for 16 px steps, Shift+Left/Right for 64 px steps, or Home/End for the limits. Double-click the edge to restore the responsive default for all matching groups. Escape cancels the resize for all matches.

Click a vertical group's header to collapse it fully to a 44 px titled rail. The table is hidden. In aligned horizontal sections, the column track keeps its expanded width while another matching group is open; once all displayed matches are collapsed, the track shrinks to 44 px throughout those sections. Click the rail to expand again at the previously chosen width. Rails retain link interaction and remain row-drop targets. Full titles are available on hover, and keyboard focus stays on the group header while toggling it.

Explicit widths are saved per grouping property/value in the Base view as `manualGroupWidths`; collapsed states continue to use `manualCollapsedGroups` separately for each occurrence. Hidden horizontal sections and collapsed matching columns use the shared width when reopened. Both settings are restored on reopening the view. Existing parent-specific widths are reused consistently; the next resize replaces the matching legacy entries with one shared setting. Resizing and collapsing do not modify note properties. Widths also survive switching a grouping level to Horizontal and back to Vertical.

Row dragging in vertical layouts does not auto-pan the board or scroll the tables inside its columns. The board and existing column tables keep their starting scroll positions while rows are dragged and while a completed move redraws the view. Normal scrolling resumes after the move or a cancelled drag. Position the board manually before dragging to a column that is off screen. Horizontal-only grouping retains its existing edge scrolling.

## Aligning vertical groups across horizontal sections

Matching vertical values share a column position as well as a width across horizontal groups. The view builds a common ordered set of values for each grouping level, using its A → Z / Z → A direction. Every existing horizontal section shows that same set of visible vertical values. Missing combinations appear as empty columns with table headers and row-drop targets, so later columns do not shift left. This does not create notes or copy files between groups.

Alignment updates live with shared resizing and is rebuilt on reopen. Empty columns use the shared saved width when available. Collapsed rails remain narrow, with space reserved when another occurrence is expanded so following values remain aligned. Nested boards under different vertical ancestor values have separate alignment scopes; boards under matching vertical ancestors can align through further horizontal sections. Filters and counts still apply only to real or retained groups and their notes.

## Reordering vertical groups

Drag the grip in a vertical group's header onto the left or right half of another column to place it before or after that value. Matching columns across horizontal sections move together and retain their alignment, shared widths, and individual collapsed states. Collapsed rails also have a grip and can be repositioned. Nested boards under different vertical ancestor values keep separate orders.

Positions are saved in the Base view as `manualVerticalGroupOrder` and restored on reopen. Manual positions take precedence over the configured group sort; new values append in their default order, and temporarily absent values remain remembered. **Group → Reset vertical group positions** restores the configured grouping order. Focus a group grip and press Alt+Left/Right to move it from the keyboard.

Group repositioning changes view settings only. It does not write note properties or numeric row ranks. Row grips continue to move files and reorder rows as before. Insertion indicators show the proposed group position; Escape cancels an active group drag.

## Choosing vertical group values

In **Group**, expand **[property] — group values** beneath a vertical grouping rule (or beneath the primary layout control). Each value shows its file count. Check or uncheck a value to show or hide its columns across horizontal sections; **Show all** and **Hide all** change the whole list. Hidden columns reserve no space, and hiding values never changes or deletes their notes. The list stays expanded while changing settings.

Drag a value using its grip to change the column order, or focus its grip and press Alt+Up/Down. Menu ordering applies across boards for that grouping property, including separate nested board scopes. Header dragging can still customize individual nested scopes afterward. Use **Reset vertical group positions** to return to the grouping sort order.

For note properties, enter a **New group value** and choose **Add group**. This creates an empty destination column without creating a note or writing frontmatter. Drop rows into it to assign the value. Values follow the property's type, including numbers and wiki links; links keep their aliases and standard Obsidian interactions. Duplicate values share one column. File and formula properties offer visibility/order controls but cannot create arbitrary unused values through this menu. Nested values appear under existing parent groups; an empty outer vertical grouping can also receive a new value before any files match the Base.

Visibility, explicitly added values and menu ordering are saved per Base view in `manualGroupValues`, together with the existing group-position settings. They are restored on reopen. Explicitly added values stay available even while unused and can be hidden when no longer needed.

## Updating cells without redrawing the table

Ordinary value edits, checkbox changes, list edits, paste operations, undo and metadata refreshes update changed cells while keeping existing tables, rows and unaffected cells mounted. Dependent formula cells update when Bases supplies their new values. Repeated notifications with unchanged values do not recreate cells. Selection, keyboard focus, list sizing and table scroll remain in place. Saving status and disabled controls update separately from table rendering.

Changes to numeric ordering values move the existing rows within their tables rather than rebuilding them. Keyboard row moves and row menus follow the updated positions. Opening, saving or cancelling an editor restores preview only in that cell; list expansion also updates the existing row.

A layout rebuild is still used when notes enter/leave the query, grouping values change, files are renamed, columns change, or group layout/settings change. Active drafts remain protected while metadata updates arrive. Incremental list replacement unregisters the previous cell from row sizing to avoid retaining obsolete list elements.


## Continuous vertical columns

Each visible vertical group value appears under every existing higher horizontal group in its alignment scope, including sections with no files for that value. Empty columns show their headers, zero count, table properties and drop area. Columns stretch to the height of their neighbors so the vertical lanes continue down the view, interrupted by higher horizontal headers. Hidden values are omitted throughout.

The same rule applies through several horizontal levels and to consecutive vertical levels. Different vertical ancestor values keep separate scopes, so nested values are not imported into unrelated outer columns. Shared widths and positions apply to empty columns as well; collapse state remains per occurrence.

Drop rows into an empty column to assign its value and the destination horizontal ancestors. Existing undo behavior applies. Empty destinations do not duplicate notes, write frontmatter on rendering, or import unrelated vault-only values. They are rebuilt on reopen from the current/retained groups and explicitly added values, using the Base's saved visibility and ordering settings.

Saved-cell overlays expose only the property's existence and value. Edit history retains the live file reference separately; incremental-render fingerprints never include that circular Obsidian object graph. This also covers row moves between groups while the metadata cache is still catching up.

## Floating row drags

Pressing a row handle selects it; the normal drag-distance threshold starts detachment. The selected rows then appear together in a floating preview that follows the cursor, with a count for multiple rows. Their source positions keep shadow placeholders at the original heights, so the table and board do not jump. The preview is clipped to fit the viewport and does not intercept drop targets.

Release over a row or group to perform the existing reorder/group move. Empty visible groups remain valid destinations. On release the floating preview disappears, while source shadows remain until the write completes. Successful moves clear the shadows; failures restore the original row presentation. Dropping outside a recognized target, dropping onto the dragged rows themselves, pressing Escape, leaving the window or cancelling the drag restores the originals without writing any changes. Refreshing or unloading the view also cleans up drag visuals. Existing board scroll locking and undo behavior remain in effect.

## Group value colors

Open **Group**, expand a property's **group values**, and click the color swatch beside a value to choose its color. The adjacent reset icon removes that value's color. Both horizontal and vertical grouping properties offer these controls; visibility, ordering and adding values remain available for vertical groups.

Colors tint vertical column backgrounds, group headers and table headers. Horizontal group headers and their directly contained tables are tinted too. Selected rows use a stronger tint from their nearest colored group; nested values can override an outer group's color. Matching property/value groups share colors across horizontal sections and nested scopes, including empty columns and collapsed rails. Aliases pointing to the same linked note use the same color identity.

Colors are saved per Base view as `manualGroupColors` and restored on reopening. They survive hiding a group or switching its orientation. Color changes update existing group styling without recreating the tables and never write note properties. Clearing an inner group's color restores inherited selected-row color from a colored ancestor, or the normal selection color when none is assigned.

## Per-group and overall summaries

Click a column header's calculator icon, or right-click its header, to choose a summary. The available native functions follow the property's type: Empty/Filled/Unique for all properties; Sum, Average, Min, Max, Median, Range and Stddev for numbers; Earliest/Latest/Range for dates; Checked/Unchecked for checkboxes. Select **None** to remove a summary. Once enabled, click a group summary or a cell in the overall total bar to change the function or summarize another column.

Each grouping level shows its summary in the group header, including collapsed groups. Empty columns are summarized with an empty entry list. The **Total** bar below the view summarizes the full visible result set once per file. Hidden group values are excluded; collapsed groups are included. Only visible columns are displayed. Removing the last visible summary hides the summary bars.

The plugin calls the public `BasesQueryResult.getSummaryValue()` API using the original query controller and current Bases entries, and renders results with the native Value renderer. Calculations, formatting and errors therefore follow Obsidian's engine. Values refresh as new query results arrive after edits, paste, group moves and undo; summary updates preserve mounted data tables. Choices use the native view-level `summaries` mapping and persist on reopen, including existing native-view configurations and custom summary names. **Use custom summary…** accepts the name of a custom formula already defined in the Base; this plugin does not create or edit top-level custom summary formulas.

Native behavior and formula names: https://obsidian.md/help/bases/views/table and https://obsidian.md/help/bases/syntax .
