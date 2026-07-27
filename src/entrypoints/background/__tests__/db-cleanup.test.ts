import { beforeEach, describe, expect, it, vi } from "vitest"

const alarmsGetMock = vi.fn<(...args: any[]) => any>()
const alarmsCreateMock = vi.fn<(...args: any[]) => any>()
const alarmsAddListenerMock = vi.fn<(...args: any[]) => any>()

const translationDeleteMock = vi.fn<(...args: any[]) => any>()
const translationWhereMock = vi.fn<(...args: any[]) => any>()

// The batch request records are no longer a Dexie table; they live on the shared
// `storage` API behind this access layer. See utils/db/batch-request-record-store.
const pruneRequestRecordsMock = vi.fn<(...args: any[]) => any>()
const clearRequestRecordsMock = vi.fn<(...args: any[]) => any>()

const broadcastCacheClearMock = vi.fn<(...args: any[]) => any>()
const watchCacheClearCommandsMock = vi.fn<(...args: any[]) => any>()

const summaryDeleteMock = vi.fn<(...args: any[]) => any>()
const summaryWhereMock = vi.fn<(...args: any[]) => any>()

const loggerInfoMock = vi.fn<(...args: any[]) => any>()
const loggerErrorMock = vi.fn<(...args: any[]) => any>()

vi.mock("#imports", () => ({
  browser: {
    alarms: {
      get: alarmsGetMock,
      create: alarmsCreateMock,
      onAlarm: {
        addListener: alarmsAddListenerMock,
      },
    },
  },
}))

vi.mock("wxt/browser", () => ({
  browser: {
    alarms: {
      get: alarmsGetMock,
      create: alarmsCreateMock,
      onAlarm: {
        addListener: alarmsAddListenerMock,
      },
    },
  },
}))

vi.mock("@/utils/batch-request-record", () => ({
  BATCH_REQUEST_RECORD_MAX_COUNT: 2000,
  clearBatchRequestRecords: clearRequestRecordsMock,
  pruneBatchRequestRecords: pruneRequestRecordsMock,
}))

vi.mock("@/utils/db/cache-clear-broadcast", () => ({
  broadcastCacheClear: broadcastCacheClearMock,
  watchCacheClearCommands: watchCacheClearCommandsMock,
}))

vi.mock("@/utils/db/dexie/db", () => ({
  db: {
    translationCache: {
      where: translationWhereMock,
      clear: vi.fn<(...args: any[]) => any>(),
    },
    articleSummaryCache: {
      where: summaryWhereMock,
      clear: vi.fn<(...args: any[]) => any>(),
    },
    aiSegmentationCache: {
      clear: vi.fn<(...args: any[]) => any>(),
    },
  },
}))

vi.mock("@/utils/logger", () => ({
  logger: {
    info: loggerInfoMock,
    error: loggerErrorMock,
  },
}))

describe("setUpDatabaseCleanup", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    alarmsGetMock.mockResolvedValue(null)
    alarmsCreateMock.mockResolvedValue(undefined)

    translationDeleteMock.mockResolvedValue(0)
    translationWhereMock.mockReturnValue({
      below: () => ({
        delete: translationDeleteMock,
      }),
    })

    pruneRequestRecordsMock.mockResolvedValue({ deletedByCount: 0, deletedByAge: 0 })
    clearRequestRecordsMock.mockResolvedValue(undefined)

    broadcastCacheClearMock.mockResolvedValue(undefined)

    summaryDeleteMock.mockResolvedValue(0)
    summaryWhereMock.mockReturnValue({
      below: () => ({
        delete: summaryDeleteMock,
      }),
    })
  })

  it("does not run cleanup immediately on setup", async () => {
    const { setUpDatabaseCleanup } = await import("../db-cleanup")
    await setUpDatabaseCleanup()

    expect(alarmsCreateMock).toHaveBeenCalledTimes(3)
    expect(alarmsAddListenerMock).toHaveBeenCalledTimes(1)

    expect(translationWhereMock).not.toHaveBeenCalled()
    expect(pruneRequestRecordsMock).not.toHaveBeenCalled()
    expect(summaryWhereMock).not.toHaveBeenCalled()

    // The per-origin caches are cleared through a broadcast the dashboard sends;
    // this is the end that listens for it.
    expect(watchCacheClearCommandsMock).toHaveBeenCalledTimes(1)
  })

  it("does not recreate alarms when they already exist", async () => {
    alarmsGetMock
      .mockResolvedValueOnce({ name: "cache-cleanup" })
      .mockResolvedValueOnce({ name: "request-record-cleanup" })
      .mockResolvedValueOnce({ name: "summary-cache-cleanup" })

    const { setUpDatabaseCleanup } = await import("../db-cleanup")
    await setUpDatabaseCleanup()

    expect(alarmsCreateMock).not.toHaveBeenCalled()
  })

  it("runs only the matching cleanup handler for each alarm", async () => {
    let alarmListener: ((alarm: { name: string }) => Promise<void>) | undefined
    alarmsAddListenerMock.mockImplementation(
      (listener: (alarm: { name: string }) => Promise<void>) => {
        alarmListener = listener
      },
    )

    const {
      setUpDatabaseCleanup,
      REQUEST_RECORD_CLEANUP_ALARM,
      SUMMARY_CACHE_CLEANUP_ALARM,
      TRANSLATION_CACHE_CLEANUP_ALARM,
    } = await import("../db-cleanup")

    await setUpDatabaseCleanup()
    if (!alarmListener) {
      throw new Error("Alarm listener was not registered")
    }

    await alarmListener({ name: TRANSLATION_CACHE_CLEANUP_ALARM })
    expect(translationWhereMock).toHaveBeenCalledTimes(1)
    expect(pruneRequestRecordsMock).not.toHaveBeenCalled()
    expect(summaryWhereMock).not.toHaveBeenCalled()

    await alarmListener({ name: REQUEST_RECORD_CLEANUP_ALARM })
    expect(pruneRequestRecordsMock).toHaveBeenCalledTimes(1)
    expect(summaryWhereMock).not.toHaveBeenCalled()

    await alarmListener({ name: SUMMARY_CACHE_CLEANUP_ALARM })
    expect(summaryWhereMock).toHaveBeenCalledTimes(1)
  })

  it("clears the local caches and broadcasts to the other origins", async () => {
    const { clearAllAiSegmentationCache, clearAllTranslationRelatedCache } = await import(
      "../db-cleanup"
    )

    await clearAllTranslationRelatedCache()
    expect(broadcastCacheClearMock).toHaveBeenLastCalledWith("translationRelated")

    await clearAllAiSegmentationCache()
    expect(broadcastCacheClearMock).toHaveBeenLastCalledWith("aiSegmentation")
  })
})
