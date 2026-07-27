/**
 * `browser.alarms` replacement.
 *
 * The extension used alarms for two periodic maintenance jobs (config backup,
 * database cleanup). A userscript has no persistent background context, so we
 * approximate with a timer in the top frame plus a persisted `lastRun` stamp so
 * the schedule survives navigation and is not restarted from zero on every page
 * load — and so twenty open tabs do not run the job twenty times.
 */

import { kv } from "@/userscript/shim/kv"
import { EventShim } from "../shim/events"

export interface ShimAlarm {
  name: string
  scheduledTime: number
  periodInMinutes?: number
}

interface AlarmCreateInfo {
  when?: number
  delayInMinutes?: number
  periodInMinutes?: number
}

const LAST_RUN_PREFIX = "rf:alarm:lastRun:"
const TICK_INTERVAL_MS = 30_000

const alarms = new Map<string, { info: AlarmCreateInfo; scheduledTime: number }>()

export const onAlarm = new EventShim<[ShimAlarm]>("alarms.onAlarm")

let tickTimer: ReturnType<typeof setInterval> | undefined

function isTopFrame() {
  try {
    return window.top === window.self
  } catch {
    return false
  }
}

async function readLastRun(name: string): Promise<number> {
  const value = await kv.get<number>(`${LAST_RUN_PREFIX}${name}`)
  return typeof value === "number" ? value : 0
}

async function claimRun(name: string, now: number, intervalMs: number): Promise<boolean> {
  const lastRun = await readLastRun(name)
  if (now - lastRun < intervalMs) return false
  // Best-effort cross-tab lock. GM storage has no compare-and-swap, so two tabs
  // ticking within the same millisecond could both claim. Both jobs guarded by
  // this are idempotent cache maintenance, so a duplicate run is harmless.
  await kv.set(`${LAST_RUN_PREFIX}${name}`, now)
  return true
}

async function tick() {
  const now = Date.now()
  for (const [name, entry] of alarms) {
    const period = entry.info.periodInMinutes
    if (period === undefined) {
      // One-shot alarm.
      if (now >= entry.scheduledTime) {
        alarms.delete(name)
        onAlarm.dispatch({ name, scheduledTime: entry.scheduledTime })
      }
      continue
    }

    const intervalMs = period * 60_000
    if (now < entry.scheduledTime) continue
    if (!(await claimRun(name, now, intervalMs))) continue

    onAlarm.dispatch({ name, scheduledTime: now, periodInMinutes: period })
  }
}

function ensureTicking() {
  if (tickTimer !== undefined || !isTopFrame()) return
  tickTimer = setInterval(() => {
    void tick()
  }, TICK_INTERVAL_MS)
  // Run one pass shortly after load so a long-overdue job is not delayed by a
  // whole tick interval.
  setTimeout(() => void tick(), 5_000)
}

export const alarmsShim = {
  create(nameOrInfo: string | AlarmCreateInfo, maybeInfo?: AlarmCreateInfo) {
    const name = typeof nameOrInfo === "string" ? nameOrInfo : ""
    const info = (typeof nameOrInfo === "string" ? maybeInfo : nameOrInfo) ?? {}
    const delayMs = (info.delayInMinutes ?? 0) * 60_000
    const scheduledTime = info.when ?? Date.now() + delayMs
    alarms.set(name, { info, scheduledTime })
    ensureTicking()
  },

  async get(name: string): Promise<ShimAlarm | undefined> {
    const entry = alarms.get(name)
    if (!entry) return undefined
    return {
      name,
      scheduledTime: entry.scheduledTime,
      periodInMinutes: entry.info.periodInMinutes,
    }
  },

  async getAll(): Promise<ShimAlarm[]> {
    return [...alarms.entries()].map(([name, entry]) => ({
      name,
      scheduledTime: entry.scheduledTime,
      periodInMinutes: entry.info.periodInMinutes,
    }))
  },

  async clear(name: string): Promise<boolean> {
    return alarms.delete(name)
  },

  async clearAll(): Promise<boolean> {
    const had = alarms.size > 0
    alarms.clear()
    return had
  },

  onAlarm,
}
