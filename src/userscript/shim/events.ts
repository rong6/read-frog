/**
 * Minimal `browser.*.onXxx` event object. Extension listeners register against
 * these exactly as before; the userscript runtime dispatches into them from
 * whatever page-level signal is the closest equivalent (or never, for events
 * that genuinely have no analogue).
 */
export class EventShim<TArgs extends any[] = any[]> {
  private listeners = new Set<(...args: TArgs) => void>()

  constructor(private readonly label: string) {}

  addListener = (listener: (...args: TArgs) => void): void => {
    this.listeners.add(listener)
  }

  removeListener = (listener: (...args: TArgs) => void): void => {
    this.listeners.delete(listener)
  }

  hasListener = (listener: (...args: TArgs) => void): boolean => {
    return this.listeners.has(listener)
  }

  hasListeners = (): boolean => this.listeners.size > 0

  /** Userscript-side dispatch. Not part of the WebExtension API. */
  dispatch = (...args: TArgs): void => {
    for (const listener of [...this.listeners]) {
      try {
        listener(...args)
      } catch (error) {
        console.error(`[read-frog] listener for ${this.label} threw`, error)
      }
    }
  }

  /** Like `dispatch`, but awaits async listeners and collects their results. */
  dispatchAsync = async (...args: TArgs): Promise<unknown[]> => {
    const results: unknown[] = []
    for (const listener of [...this.listeners]) {
      try {
        results.push(await (listener as (...a: TArgs) => unknown)(...args))
      } catch (error) {
        console.error(`[read-frog] listener for ${this.label} threw`, error)
      }
    }
    return results
  }
}
