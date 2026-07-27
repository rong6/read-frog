/**
 * Options-page card for WebDAV config sync.
 *
 * Deliberately the same shape as `../google-drive-sync/index.tsx`: same
 * `ConfigCard`, same last-sync-time footer, same conflict dialog hand-off. The
 * extra pieces are the endpoint form (WebDAV has no OAuth) and the explicit
 * Test / Upload / Download actions.
 */

import { Icon } from "@iconify/react"
import { useAtomValue, useSetAtom } from "jotai"
import { Activity, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { toastManager } from "@/components/ui/base-ui/toast"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { webdavLastSyncTimeAtom } from "@/utils/atoms/last-sync-time"
import { resolutionsAtom, unresolvedConfigsAtom } from "@/utils/atoms/webdav-sync"
import { i18n } from "@/utils/i18n"
import { logger } from "@/utils/logger"
import { testConnection } from "@/utils/webdav/api"
import { downloadConfig, getWebDAVAccountId, syncConfig, uploadConfig } from "@/utils/webdav/sync"
import { isWebDAVConfigured } from "@/utils/webdav/types"
import { ConfigCard } from "../../../components/config-card"
import { ConnectionFields } from "./components/connection-fields"
import { UnresolvedDialog } from "./components/unresolved-dialog"

type PendingAction = "test" | "sync" | "upload" | "download"

export function WebDAVSyncCard() {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const webdav = useAtomValue(configFieldsAtomMap.webdav)
  const setUnresolvedData = useSetAtom(unresolvedConfigsAtom)
  const setResolutions = useSetAtom(resolutionsAtom)
  const lastSyncTime = useAtomValue(webdavLastSyncTimeAtom)

  const isConfigured = isWebDAVConfigured(webdav)
  const isBusy = pendingAction !== null

  const handleTest = async () => {
    setPendingAction("test")
    try {
      await testConnection(webdav)
      toastManager.add({
        type: "success",
        title: i18n.t("options.config.sync.webdav.testSuccess"),
      })
    } catch (error) {
      logger.error("WebDAV connection test failed", error)
      toastManager.add({
        type: "error",
        title: i18n.t("options.config.sync.webdav.testError"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPendingAction(null)
    }
  }

  const handleSync = async () => {
    setPendingAction("sync")

    const result = await syncConfig()

    if (result.status === "unresolved") {
      setUnresolvedData(result.data)
      setIsOpen(true)
    } else if (result.status === "success") {
      const messages = {
        uploaded: i18n.t("options.config.sync.webdav.syncSuccess.uploaded"),
        downloaded: i18n.t("options.config.sync.webdav.syncSuccess.downloaded"),
        "same-changes": i18n.t("options.config.sync.webdav.syncSuccess.sameChanges"),
        "no-change": i18n.t("options.config.sync.webdav.syncSuccess.noChange"),
      } as const
      toastManager.add({ type: "success", title: messages[result.action] })
    } else {
      logger.error("WebDAV sync error", result.error)
      toastManager.add({
        type: "error",
        title: i18n.t("options.config.sync.webdav.syncError"),
        description: result.error.message,
      })
    }

    setPendingAction(null)
  }

  const handleUpload = async () => {
    setPendingAction("upload")
    const result = await uploadConfig()
    if (result.status === "success") {
      toastManager.add({
        type: "success",
        title: i18n.t("options.config.sync.webdav.syncSuccess.uploaded"),
      })
    } else if (result.status === "error") {
      logger.error("WebDAV upload error", result.error)
      toastManager.add({
        type: "error",
        title: i18n.t("options.config.sync.webdav.syncError"),
        description: result.error.message,
      })
    }
    setPendingAction(null)
  }

  const handleDownload = async () => {
    setPendingAction("download")
    const result = await downloadConfig()
    if (result.status === "success") {
      toastManager.add({
        type: "success",
        title: i18n.t("options.config.sync.webdav.syncSuccess.downloaded"),
      })
    } else if (result.status === "error") {
      logger.error("WebDAV download error", result.error)
      toastManager.add({
        type: "error",
        title: i18n.t("options.config.sync.webdav.syncError"),
        description: result.error.message,
      })
    }
    setPendingAction(null)
  }

  const handleDialogClose = (success: boolean) => {
    setIsOpen(false)
    setResolutions({})
    if (success) {
      toastManager.add({
        type: "success",
        title: i18n.t("options.config.sync.webdav.syncSuccess.unresolved"),
      })
    } else {
      toastManager.add({
        type: "error",
        title: i18n.t("options.config.sync.webdav.syncError"),
      })
    }
  }

  const formatLastSyncTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString()
  }

  return (
    <>
      <ConfigCard
        id="webdav-sync"
        title={i18n.t("options.config.sync.webdav.title")}
        description={
          <div className="flex flex-col gap-2">
            {i18n.t("options.config.sync.webdav.description")}
            <Activity mode={isConfigured ? "visible" : "hidden"}>
              <div className="flex items-center gap-2 text-sm">
                <Icon icon="mdi:server-network" className="size-4 shrink-0" />
                <span className="text-sm break-all text-muted-foreground">
                  {getWebDAVAccountId(webdav)}
                </span>
              </div>
            </Activity>
          </div>
        }
      >
        <div className="flex w-full flex-col items-end gap-4">
          <ConnectionFields disabled={isBusy} />

          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={handleTest} disabled={isBusy || !isConfigured}>
                <Icon icon="tabler:plug-connected" className="size-4" />
                {pendingAction === "test"
                  ? i18n.t("options.config.sync.webdav.testing")
                  : i18n.t("options.config.sync.webdav.test")}
              </Button>
              <Button variant="outline" onClick={handleUpload} disabled={isBusy || !isConfigured}>
                <Icon icon="tabler:cloud-upload" className="size-4" />
                {pendingAction === "upload"
                  ? i18n.t("options.config.sync.webdav.uploading")
                  : i18n.t("options.config.sync.webdav.upload")}
              </Button>
              <Button variant="outline" onClick={handleDownload} disabled={isBusy || !isConfigured}>
                <Icon icon="tabler:cloud-download" className="size-4" />
                {pendingAction === "download"
                  ? i18n.t("options.config.sync.webdav.downloading")
                  : i18n.t("options.config.sync.webdav.download")}
              </Button>
              <Button onClick={handleSync} disabled={isBusy || !isConfigured}>
                <Icon icon="mdi:cloud-sync" className="size-4" />
                {pendingAction === "sync"
                  ? i18n.t("options.config.sync.webdav.syncing")
                  : i18n.t("options.config.sync.webdav.sync")}
              </Button>
            </div>
            <Activity mode={isConfigured ? "hidden" : "visible"}>
              <span className="text-xs text-muted-foreground">
                {i18n.t("options.config.sync.webdav.notConfigured")}
              </span>
            </Activity>
            <Activity mode={lastSyncTime ? "visible" : "hidden"}>
              <span className="text-xs text-muted-foreground">
                {i18n.t("options.config.sync.webdav.lastSyncTime")}:{" "}
                {lastSyncTime && formatLastSyncTime(lastSyncTime)}
              </span>
            </Activity>
          </div>
        </div>
      </ConfigCard>

      <UnresolvedDialog
        open={isOpen}
        onResolved={() => handleDialogClose(true)}
        onCancelled={() => handleDialogClose(false)}
      />
    </>
  )
}
