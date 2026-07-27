/**
 * WebDAV twin of `use-unresolved-field.ts`. Identical behaviour, but bound to the
 * WebDAV conflict atoms so a Drive resolution and a WebDAV resolution never share
 * state.
 */

import type { FieldConflict } from "@/utils/webdav/conflict-merge"
import { useAtomValue, useSetAtom } from "jotai"
import { useMemo } from "react"
import {
  diffConflictsResultAtom,
  resetResolutionAtom,
  resolutionsAtom,
  selectResolutionAtom,
} from "@/utils/atoms/webdav-sync"

export interface UseWebDAVConflictFieldResult {
  conflict: FieldConflict | undefined
  resolution: "local" | "remote" | undefined
  selectLocal: () => void
  selectRemote: () => void
  reset: () => void
}

export function useWebDAVConflictField(pathKey: string): UseWebDAVConflictFieldResult {
  const diffResult = useAtomValue(diffConflictsResultAtom)
  const resolutions = useAtomValue(resolutionsAtom)
  const selectResolution = useSetAtom(selectResolutionAtom)
  const resetResolution = useSetAtom(resetResolutionAtom)

  return useMemo(() => {
    const conflict = diffResult?.conflicts.find((c) => c.path.join(".") === pathKey)

    return {
      conflict,
      resolution: resolutions[pathKey],
      selectLocal: () => selectResolution({ pathKey, resolution: "local" }),
      selectRemote: () => selectResolution({ pathKey, resolution: "remote" }),
      reset: () => resetResolution(pathKey),
    }
  }, [diffResult, resolutions, pathKey, selectResolution, resetResolution])
}
