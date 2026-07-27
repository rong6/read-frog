import { browser } from "#imports"
import {
  BATCH_REQUEST_RECORD_MAX_COUNT,
  clearBatchRequestRecords,
  pruneBatchRequestRecords,
} from "@/utils/batch-request-record"
import { broadcastCacheClear, watchCacheClearCommands } from "@/utils/db/cache-clear-broadcast"
import { db } from "@/utils/db/dexie/db"
import { logger } from "@/utils/logger"

export const CHECK_INTERVAL_MINUTES = 24 * 60

export const TRANSLATION_CACHE_CLEANUP_ALARM = "cache-cleanup"
export const TRANSLATION_CACHE_MAX_AGE_MINUTES = 7 * 24 * 60

export const REQUEST_RECORD_CLEANUP_ALARM = "request-record-cleanup"
// Alias of the store's own cap, so there is one number: the store enforces it on
// every write (the records share a single storage value now and cannot be
// allowed to grow unbounded), and this alarm only has to catch up on age.
export const REQUEST_RECORD_MAX_COUNT = BATCH_REQUEST_RECORD_MAX_COUNT
export const REQUEST_RECORD_MAX_AGE_DAYS = 120

export const SUMMARY_CACHE_CLEANUP_ALARM = "summary-cache-cleanup"
export const SUMMARY_CACHE_MAX_AGE_MINUTES = 7 * 24 * 60

let isCleanupDisabled = false

/**
 * Opt this context out of the cleanup alarms entirely. Must be called before the
 * background's `main()` runs.
 *
 * Everything below prunes Dexie, which is per-origin, while the scheduling that
 * drives it may not be: in the userscript build the alarms are claimed through a
 * single "last run" stamp shared by every context. A context that holds a
 * *different* database from the one translations are written to must therefore
 * stay out of the claim rather than win it, prune nothing, and suppress the real
 * cleanup until the period comes round again.
 */
export function disableDatabaseCleanup() {
  isCleanupDisabled = true
}

export async function setUpDatabaseCleanup() {
  // Deliberately above the opt-out below: skipping the alarms is about not
  // winning a *shared* claim on periodic work, while this is about the database
  // this context owns. A context that prunes nothing still has to honour a clear
  // — and a "clear cache" click on the dashboard cannot reach the per-origin
  // caches any other way. Inert in the extension build.
  watchCacheClearCommands({
    translationRelated: async () => {
      await cleanupAllTranslationCache()
      await cleanupAllSummaryCache()
    },
    aiSegmentation: async () => {
      await cleanupAllAiSegmentationCache()
    },
  })

  if (isCleanupDisabled) {
    logger.info("Database cleanup disabled for this context")
    return
  }

  // Set up periodic alarms (only if they don't exist)
  const existingCacheAlarm = await browser.alarms.get(TRANSLATION_CACHE_CLEANUP_ALARM)
  if (!existingCacheAlarm) {
    void browser.alarms.create(TRANSLATION_CACHE_CLEANUP_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: CHECK_INTERVAL_MINUTES,
    })
  }

  const existingRequestAlarm = await browser.alarms.get(REQUEST_RECORD_CLEANUP_ALARM)
  if (!existingRequestAlarm) {
    void browser.alarms.create(REQUEST_RECORD_CLEANUP_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: CHECK_INTERVAL_MINUTES,
    })
  }

  const existingSummaryAlarm = await browser.alarms.get(SUMMARY_CACHE_CLEANUP_ALARM)
  if (!existingSummaryAlarm) {
    void browser.alarms.create(SUMMARY_CACHE_CLEANUP_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: CHECK_INTERVAL_MINUTES,
    })
  }

  // Register the alarm listener
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === TRANSLATION_CACHE_CLEANUP_ALARM) {
      await cleanupOldTranslationCache()
    } else if (alarm.name === REQUEST_RECORD_CLEANUP_ALARM) {
      await cleanupOldRequestRecords()
    } else if (alarm.name === SUMMARY_CACHE_CLEANUP_ALARM) {
      await cleanupOldSummaryCache()
    }
  })
}

async function cleanupOldTranslationCache() {
  try {
    const cutoffDate = new Date()
    cutoffDate.setTime(cutoffDate.getTime() - TRANSLATION_CACHE_MAX_AGE_MINUTES * 60 * 1000)

    // Delete all cache entries older than the cutoff date
    const deletedCount = await db.translationCache.where("createdAt").below(cutoffDate).delete()

    if (deletedCount > 0) {
      logger.info(`Cache cleanup: Deleted ${deletedCount} old translation cache entries`)
    }
  } catch (error) {
    logger.error("Failed to cleanup old cache:", error)
  }
}

export async function cleanupAllTranslationCache() {
  try {
    // Delete all translation cache entries
    await db.translationCache.clear()

    logger.info(`Cache cleanup: Deleted all translation cache entries`)
  } catch (error) {
    logger.error("Failed to cleanup all cache:", error)
    throw error
  }
}

async function cleanupOldRequestRecords() {
  try {
    // Age and count are pruned in one pass so a concurrent write cannot slip
    // between them — the records are a single storage value now, not a table.
    const { deletedByCount, deletedByAge } = await pruneBatchRequestRecords({
      maxCount: REQUEST_RECORD_MAX_COUNT,
      maxAgeDays: REQUEST_RECORD_MAX_AGE_DAYS,
    })

    if (deletedByCount > 0) {
      logger.info(
        `Request records cleanup: Deleted ${deletedByCount} oldest records (count exceeded ${REQUEST_RECORD_MAX_COUNT})`,
      )
    }

    if (deletedByAge > 0) {
      logger.info(
        `Request records cleanup: Deleted ${deletedByAge} records older than ${REQUEST_RECORD_MAX_AGE_DAYS} days`,
      )
    }
  } catch (error) {
    logger.error("Failed to cleanup old request records:", error)
  }
}

export async function cleanupAllRequestRecords() {
  try {
    // Delete all batch request records
    await clearBatchRequestRecords()

    logger.info(`Request records cleanup: Deleted all batch request records`)
  } catch (error) {
    logger.error("Failed to cleanup all request records:", error)
    throw error
  }
}

async function cleanupOldSummaryCache() {
  try {
    const cutoffDate = new Date()
    cutoffDate.setTime(cutoffDate.getTime() - SUMMARY_CACHE_MAX_AGE_MINUTES * 60 * 1000)

    // Delete all summary cache entries older than the cutoff date
    const deletedCount = await db.articleSummaryCache.where("createdAt").below(cutoffDate).delete()

    if (deletedCount > 0) {
      logger.info(
        `Summary cache cleanup: Deleted ${deletedCount} old article summary cache entries`,
      )
    }
  } catch (error) {
    logger.error("Failed to cleanup old summary cache:", error)
  }
}

export async function cleanupAllSummaryCache() {
  try {
    // Delete all article summary cache entries
    await db.articleSummaryCache.clear()

    logger.info(`Summary cache cleanup: Deleted all article summary cache entries`)
  } catch (error) {
    logger.error("Failed to cleanup all summary cache:", error)
    throw error
  }
}

export async function cleanupAllAiSegmentationCache() {
  try {
    await db.aiSegmentationCache.clear()
    logger.info("AI segmentation cache cleanup: Deleted all entries")
  } catch (error) {
    logger.error("Failed to cleanup all AI segmentation cache:", error)
    throw error
  }
}

/**
 * What the dashboard's "clear cache" button ends up calling.
 *
 * It clears this context's own database first — in the extension build that is
 * the only one there is and the broadcast below does nothing, so the behaviour
 * is exactly what it always was — and then tells the other origins to do the
 * same. Without that second half the userscript build wipes the dashboard's own
 * empty database and reports success, which is a lie.
 */
export async function clearAllTranslationRelatedCache() {
  await cleanupAllTranslationCache()
  await cleanupAllSummaryCache()
  await broadcastCacheClear("translationRelated")
}

/** As above, for the AI segmentation cache. */
export async function clearAllAiSegmentationCache() {
  await cleanupAllAiSegmentationCache()
  await broadcastCacheClear("aiSegmentation")
}
