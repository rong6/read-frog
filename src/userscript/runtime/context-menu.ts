/**
 * `browser.contextMenus` mapped onto the userscript manager's script menu.
 *
 * The extension builds a real right-click menu (page-translate toggle, selection
 * translate / read-aloud / custom actions). Userscript managers expose a flat
 * command list under the extension's own toolbar icon instead — no nesting, no
 * per-context filtering, and no `info.selectionText` handed to us.
 *
 * So: we keep the full menu model that `background/context-menu.ts` builds (that
 * file is unchanged), render every *leaf* item as a GM menu command, and read
 * the live selection off the document at click time to reconstruct
 * `info.selectionText`. Items whose only context is `selection` are registered
 * but simply do nothing when there is no selection, which matches how the real
 * menu behaves (it would not have been shown at all).
 */

import { gmRegisterMenuCommand, gmUnregisterMenuCommand } from "../gm/api"
import { EventShim } from "../shim/events"

export interface ShimMenuItem {
  id: string
  title?: string
  contexts?: string[]
  parentId?: string
  type?: string
  enabled?: boolean
  visible?: boolean
}

export interface ShimMenuClickInfo {
  menuItemId: string
  parentMenuItemId?: string
  selectionText?: string
  pageUrl: string
  frameId?: number
  editable: boolean
}

export interface ShimMenuTab {
  id: number
  windowId: number
  url: string
  active: boolean
}

const items = new Map<string, ShimMenuItem>()
const registeredCommands = new Map<string, number | string | undefined>()

export const onClicked = new EventShim<[ShimMenuClickInfo, ShimMenuTab | undefined]>(
  "contextMenus.onClicked",
)

let renderScheduled = false

function isTopFrame() {
  try {
    return window.top === window.self
  } catch {
    return false
  }
}

function currentSelectionText(): string {
  try {
    return window.getSelection()?.toString().trim() ?? ""
  } catch {
    return ""
  }
}

function currentTab(): ShimMenuTab {
  return { id: 0, windowId: 0, url: location.href, active: !document.hidden }
}

function hasChildren(id: string): boolean {
  for (const item of items.values()) {
    if (item.parentId === id) return true
  }
  return false
}

function labelFor(item: ShimMenuItem): string {
  const parent = item.parentId ? items.get(item.parentId) : undefined
  const own = (item.title ?? item.id).replaceAll("&", "")
  if (!parent) return own
  const parentTitle = (parent.title ?? parent.id).replaceAll("&", "")
  return `${parentTitle} › ${own}`
}

function clearRegistered() {
  for (const handle of registeredCommands.values()) {
    gmUnregisterMenuCommand(handle)
  }
  registeredCommands.clear()
}

function render() {
  renderScheduled = false
  if (!isTopFrame()) return

  clearRegistered()

  for (const item of items.values()) {
    if (item.visible === false) continue
    if (item.type === "separator") continue
    // Only leaves are actionable; parents exist purely to group.
    if (hasChildren(item.id)) continue

    const handle = gmRegisterMenuCommand(labelFor(item), () => {
      const selectionText = currentSelectionText()
      onClicked.dispatch(
        {
          menuItemId: item.id,
          parentMenuItemId: item.parentId,
          selectionText: selectionText || undefined,
          pageUrl: location.href,
          frameId: 0,
          editable: false,
        },
        currentTab(),
      )
    })
    registeredCommands.set(item.id, handle)
  }
}

function scheduleRender() {
  if (renderScheduled) return
  renderScheduled = true
  // The background rebuilds the menu item-by-item; coalesce into one pass so we
  // do not thrash the manager's menu on every create() call.
  queueMicrotask(render)
}

export const contextMenusShim = {
  create(item: ShimMenuItem, callback?: () => void) {
    if (item.id) {
      items.set(item.id, item)
      scheduleRender()
    }
    callback?.()
    return item.id
  },

  async update(id: string, changes: Partial<ShimMenuItem>) {
    const existing = items.get(id)
    if (!existing) return
    items.set(id, { ...existing, ...changes })
    scheduleRender()
  },

  async remove(id: string) {
    items.delete(id)
    scheduleRender()
  },

  async removeAll(callback?: () => void) {
    items.clear()
    scheduleRender()
    callback?.()
  },

  onClicked,
}
