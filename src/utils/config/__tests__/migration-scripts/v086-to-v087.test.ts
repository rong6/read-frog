import { describe, expect, it } from "vitest"
import { migrate } from "../../migration-scripts/v086-to-v087"

describe("v086-to-v087 migration", () => {
  it("adds empty webdav settings with the default directory", () => {
    const migrated = migrate({ uiLanguage: "auto" })
    expect(migrated.webdav).toEqual({
      url: "",
      username: "",
      directory: "read-frog",
    })
  })

  it("preserves already-set webdav settings (idempotent)", () => {
    const webdav = {
      url: "https://dav.example.com",
      username: "frog",
      directory: "configs/read-frog",
    }
    const migrated = migrate({ webdav })
    expect(migrated.webdav).toEqual(webdav)
  })

  it("strips a password carried by an incoming config", () => {
    const migrated = migrate({
      webdav: {
        url: "https://dav.example.com",
        username: "frog",
        password: "secret",
        directory: "read-frog",
      },
    })
    expect(migrated.webdav).not.toHaveProperty("password")
    expect(migrated.webdav).toEqual({
      url: "https://dav.example.com",
      username: "frog",
      directory: "read-frog",
    })
  })

  it("leaves other top-level fields untouched", () => {
    const migrated = migrate({
      uiLanguage: "ja",
      selectionToolbar: { enabled: false, opacity: 80 },
    })
    expect(migrated.uiLanguage).toBe("ja")
    expect(migrated.selectionToolbar).toEqual({ enabled: false, opacity: 80 })
  })

  it("returns non-object input unchanged", () => {
    expect(migrate(null)).toBeNull()
    expect(migrate(undefined)).toBeUndefined()
  })
})
