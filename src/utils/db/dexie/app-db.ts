import type { EntityTable } from "dexie"
import type { LegacyBatchRequestRecord } from "@/utils/db/legacy-batch-request-records"
import { upperCamelCase } from "case-anything"
import Dexie from "dexie"
import { APP_NAME } from "@/utils/constants/app"
import { stashLegacyBatchRequestRecords } from "@/utils/db/legacy-batch-request-records"
import { logger } from "@/utils/logger"
import AiSegmentationCache from "./tables/ai-segmentation-cache"
import ArticleSummaryCache from "./tables/article-summary-cache"
import TranslationCache from "./tables/translation-cache"

export default class AppDB extends Dexie {
  translationCache!: EntityTable<TranslationCache, "key">

  articleSummaryCache!: EntityTable<ArticleSummaryCache, "key">

  aiSegmentationCache!: EntityTable<AiSegmentationCache, "key">

  constructor() {
    super(`${upperCamelCase(APP_NAME)}DB`)
    this.version(1).stores({
      translationCache: `
        key,
        translation,
        createdAt`,
    })
    this.version(2).stores({
      translationCache: `
        key,
        translation,
        createdAt`,
      batchRequestRecord: `
        key,
        createdAt,
        originalRequestCount,
        provider,
        model`,
    })
    this.version(3).stores({
      translationCache: `
        key,
        translation,
        createdAt`,
      batchRequestRecord: `
        key,
        createdAt,
        originalRequestCount,
        provider,
        model`,
      articleSummaryCache: `
        key,
        createdAt`,
    })
    this.version(4).stores({
      translationCache: `
        key,
        translation,
        createdAt`,
      batchRequestRecord: `
        key,
        createdAt,
        originalRequestCount,
        provider,
        model`,
      articleSummaryCache: `
        key,
        createdAt`,
      aiSegmentationCache: `
        key,
        createdAt`,
    })
    // Statistics moved off IndexedDB, which is origin-scoped: in the userscript
    // build the records ended up scattered one database per translated site and
    // the dashboard, on its own origin, never saw a single one. They live in the
    // shared `storage` API now — see utils/db/batch-request-record-store.ts.
    //
    // Dropping the table is a new version rather than an edit to the ones above,
    // so installs that never saw version 5 still walk the same chain. Dexie
    // keeps a table that a version deletes readable inside that version's
    // upgrade callback — the object store is dropped in a step queued after the
    // upgrader — which is the one chance there is to drain the rows.
    this.version(5)
      .stores({
        translationCache: `
        key,
        translation,
        createdAt`,
        batchRequestRecord: null,
        articleSummaryCache: `
        key,
        createdAt`,
        aiSegmentationCache: `
        key,
        createdAt`,
      })
      .upgrade(async (tx) => {
        try {
          const legacyRecords = (await tx
            .table("batchRequestRecord")
            .toArray()) as LegacyBatchRequestRecord[]
          // Parked in memory rather than written to `storage` here: awaiting a
          // non-Dexie promise inside a versionchange transaction lets IndexedDB
          // auto-commit it, and Dexie still needs it to delete the object store.
          stashLegacyBatchRequestRecords(legacyRecords)
        } catch (error) {
          // Never abort the upgrade over statistics — throwing here would leave
          // the whole database, translation cache included, unopenable.
          logger.error("Failed to drain the legacy batch request record table", error)
        }
      })
    this.translationCache.mapToClass(TranslationCache)
    this.articleSummaryCache.mapToClass(ArticleSummaryCache)
    this.aiSegmentationCache.mapToClass(AiSegmentationCache)
  }
}
