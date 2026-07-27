/**
 * No-op stand-in for `posthog-js`.
 *
 * The userscript build aliases `posthog-js/dist/module.no-external` here. Two
 * reasons, in order of importance:
 *
 *  1. A third-party redistribution should not ship telemetry pointing at the
 *     upstream project's PostHog instance. Events from userscript installs would
 *     silently pollute their product analytics.
 *  2. It removes a sizeable dependency from a bundle that has to be downloaded
 *     in full on every install.
 *
 * `src/entrypoints/background/analytics.ts` is otherwise untouched: every
 * `analytics.track*` call site, the opt-in toggle in settings, and the
 * prompt-experiment plumbing all still run — they just resolve to no-ops here.
 * `getFeatureFlag` returning `undefined` is the same answer the real client
 * gives before flags load, which the experiment code already handles by falling
 * back to the control variant.
 */

export interface CaptureResult {
  uuid: string
  event: string
  properties: Record<string, unknown>
  timestamp?: Date
}

const noop = () => {}

const posthog = {
  init: () => posthog,
  capture: (_event?: string, _properties?: Record<string, unknown>) => undefined,
  register: noop,
  registerOnce: noop,
  unregister: noop,
  identify: noop,
  reset: noop,
  opt_in_capturing: noop,
  opt_out_capturing: noop,
  has_opted_out_capturing: () => true,
  getFeatureFlag: (_key?: string) => undefined,
  isFeatureEnabled: (_key?: string) => false,
  onFeatureFlags: (_callback?: (flags: string[]) => void) => noop,
  reloadFeatureFlags: noop,
  get_distinct_id: () => "userscript",
  people: { set: noop, set_once: noop },
}

export type PostHog = typeof posthog

export { posthog }
export default posthog
