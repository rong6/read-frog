/**
 * Value-formatting helpers for the WebDAV conflict tree.
 *
 * These are pure string helpers with nothing backend-specific about them, so the
 * Google Drive implementations are re-exported instead of copied — keeping the
 * two conflict trees rendering values identically.
 */

export { formatValue, isMeaningfulFieldKey } from "../../google-drive-sync/components/utils"
