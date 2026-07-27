import { beforeEach, describe, expect, it, vi } from "vitest"

// The store opens the database only to make sure the version 5 upgrade — the one
// that drains the legacy table — has run. Nothing here needs a real IndexedDB.
const dbOpenMock = vi.fn<(...args: any[]) => any>()

vi.mock("@/utils/db/dexie/db", () => ({
  db: {
    open: dbOpenMock,
  },
}))

const storageValues = new Map<string, unknown>()

function createRecord(key: string, createdAt: Date, originalRequestCount = 4) {
  return { key, createdAt, originalRequestCount, provider: "openai", model: "gpt-4o-mini" }
}

function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

describe("batch request record store", () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    storageValues.clear()
    dbOpenMock.mockResolvedValue(undefined)

    // Patched after resetModules so the store imported by each test below sees
    // the same module instance.
    const { storage } = await import("#imports")
    storage.getItem = vi.fn<(...args: any[]) => any>((key: string) =>
      Promise.resolve(storageValues.get(key) ?? null),
    )
    storage.setItem = vi.fn<(...args: any[]) => any>((key: string, value: unknown) => {
      storageValues.set(key, value)
      return Promise.resolve()
    })
    storage.removeItem = vi.fn<(...args: any[]) => any>((key: string) => {
      storageValues.delete(key)
      return Promise.resolve()
    })
  })

  it("persists dates as epoch milliseconds and reads them back as dates", async () => {
    const { addBatchRequestRecords, getAllBatchRequestRecords } = await import(
      "../db/batch-request-record-store"
    )

    const createdAt = daysAgo(1)
    await addBatchRequestRecords([createRecord("a", createdAt)])

    // Neither storage backend preserves a Date: both serialise to JSON.
    expect(storageValues.get("local:batchRequestRecords")).toEqual([
      {
        key: "a",
        createdAt: createdAt.getTime(),
        originalRequestCount: 4,
        provider: "openai",
        model: "gpt-4o-mini",
      },
    ])

    const [record] = await getAllBatchRequestRecords()
    expect(record.createdAt).toBeInstanceOf(Date)
    expect(record.createdAt.getTime()).toBe(createdAt.getTime())
  })

  it("returns only the records inside the requested day range", async () => {
    const { addBatchRequestRecords } = await import("../db/batch-request-record-store")
    const { getRangeBatchRequestRecords } = await import("../batch-request-record")

    await addBatchRequestRecords([
      createRecord("recent", daysAgo(1)),
      createRecord("old", daysAgo(10)),
    ])

    const records = await getRangeBatchRequestRecords(4)
    expect(records.map((record) => record.key)).toEqual(["recent"])
  })

  it("caps the number of retained records on every write", async () => {
    const { addBatchRequestRecords, BATCH_REQUEST_RECORD_MAX_COUNT, getAllBatchRequestRecords } =
      await import("../db/batch-request-record-store")

    const overflow = 5
    const total = BATCH_REQUEST_RECORD_MAX_COUNT + overflow
    const records = Array.from({ length: total }, (_, index) =>
      // Oldest first: `key-0` is the furthest back, one minute between each.
      createRecord(`key-${index}`, new Date(Date.now() - (total - index) * 60 * 1000)),
    )
    await addBatchRequestRecords(records)

    const stored = await getAllBatchRequestRecords()
    const keys = new Set(stored.map((record) => record.key))
    expect(stored).toHaveLength(BATCH_REQUEST_RECORD_MAX_COUNT)
    expect(keys.has("key-0")).toBe(false)
    expect(keys.has(`key-${overflow - 1}`)).toBe(false)
    expect(keys.has(`key-${overflow}`)).toBe(true)
    expect(keys.has(`key-${total - 1}`)).toBe(true)
  })

  it("prunes by age and by count in a single pass", async () => {
    const { addBatchRequestRecords, getAllBatchRequestRecords, pruneBatchRequestRecords } =
      await import("../db/batch-request-record-store")

    await addBatchRequestRecords([
      createRecord("ancient", daysAgo(200)),
      createRecord("older", daysAgo(3)),
      createRecord("newer", daysAgo(1)),
    ])

    const result = await pruneBatchRequestRecords({ maxCount: 1, maxAgeDays: 120 })
    expect(result).toEqual({ deletedByAge: 1, deletedByCount: 1 })

    const stored = await getAllBatchRequestRecords()
    expect(stored.map((record) => record.key)).toEqual(["newer"])
  })

  it("clears every record", async () => {
    const { addBatchRequestRecords, clearBatchRequestRecords, countBatchRequestRecords } =
      await import("../db/batch-request-record-store")

    await addBatchRequestRecords([createRecord("a", daysAgo(1))])
    await clearBatchRequestRecords()

    expect(await countBatchRequestRecords()).toBe(0)
  })

  it("imports the rows drained from the legacy Dexie table", async () => {
    const store = await import("../db/batch-request-record-store")
    const { stashLegacyBatchRequestRecords } = await import("../db/legacy-batch-request-records")

    const createdAt = daysAgo(2)
    stashLegacyBatchRequestRecords([
      { key: "legacy", createdAt, originalRequestCount: 7, provider: "openai", model: "gpt-4o" },
      // A malformed row must not reach the charts as an Invalid Date.
      { key: "broken", createdAt: undefined, originalRequestCount: 1 },
    ])

    const records = await store.getAllBatchRequestRecords()
    expect(records.map((record) => record.key)).toEqual(["legacy"])
    expect(records[0].createdAt.getTime()).toBe(createdAt.getTime())
    // Opening the database is what runs the upgrade that hands the rows over.
    expect(dbOpenMock).toHaveBeenCalled()
  })

  it("does not let legacy rows resurrect records that are already there", async () => {
    const store = await import("../db/batch-request-record-store")
    const { stashLegacyBatchRequestRecords } = await import("../db/legacy-batch-request-records")

    await store.addBatchRequestRecords([createRecord("current", daysAgo(1))])
    stashLegacyBatchRequestRecords([
      { key: "legacy", createdAt: daysAgo(2), originalRequestCount: 7, provider: "", model: "" },
    ])

    const records = await store.getAllBatchRequestRecords()
    expect(records.map((record) => record.key)).toEqual(["current"])
  })
})
