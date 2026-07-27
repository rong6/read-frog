import type { ProviderConfig } from "@/types/config/provider"
import type BatchRequestRecord from "@/utils/db/dexie/tables/batch-request-record"
import { isLLMProviderConfig } from "@/types/config/provider"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import {
  addBatchRequestRecords,
  getAllBatchRequestRecords,
} from "@/utils/db/batch-request-record-store"
import { getDateFromDaysBack, numberToPercentage } from "@/utils/utils"
import { logger } from "./logger"

// The records live on the WXT `storage` API rather than in Dexie, because
// IndexedDB is origin-scoped and the dashboard runs on its own origin. See
// `utils/db/batch-request-record-store.ts` for the storage key and the details.
export {
  addBatchRequestRecords,
  BATCH_REQUEST_RECORD_MAX_COUNT,
  clearBatchRequestRecords,
  countBatchRequestRecords,
  pruneBatchRequestRecords,
} from "@/utils/db/batch-request-record-store"

export async function getRangeBatchRequestRecords(startDay: number, endDay?: number) {
  const startDate = getDateFromDaysBack(startDay)
  const endDate = getDateFromDaysBack(endDay ?? 0)

  startDate.setHours(0, 0, 0, 0)
  endDate.setHours(23, 59, 59, 999)

  // The Dexie version indexed `createdAt` and range-scanned it. A key-value
  // backend has no indexes, so the range becomes a filter over the whole set —
  // affordable precisely because that set is hard-capped.
  const records = await getAllBatchRequestRecords()
  return records.filter((record) => record.createdAt >= startDate && record.createdAt <= endDate)
}

export async function putBatchRequestRecord({
  originalRequestCount,
  providerConfig,
}: {
  originalRequestCount: number
  providerConfig: ProviderConfig
}) {
  if (!isLLMProviderConfig(providerConfig)) return

  const { provider, model: providerModel } = providerConfig
  const modelName = providerModel.isCustomModel ? providerModel.customModel : providerModel.model

  try {
    await addBatchRequestRecords([
      {
        key: getRandomUUID(),
        createdAt: new Date(),
        originalRequestCount,
        provider,
        model: modelName ?? "",
      },
    ])
  } catch (error) {
    logger.error("Failed to put batch request record", error)
  }
}

export function calculateAverageSavePercentage(batchRequestRecords: BatchRequestRecord[]): string {
  if (!batchRequestRecords.length) return "0%"

  const originalRequestCount = batchRequestRecords.reduce(
    (acc, record) => acc + record.originalRequestCount,
    0,
  )
  const batchRequestCount = batchRequestRecords.length

  const averageSavePercent = (originalRequestCount - batchRequestCount) / originalRequestCount
  return numberToPercentage(averageSavePercent)
}
