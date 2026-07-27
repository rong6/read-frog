/**
 * Post-processes the Vite output into an installable `.user.js`.
 *
 * Three jobs:
 *   1. Discard the emitted stylesheet. Every stylesheet this app injects at
 *      runtime does so itself (`?inline` / `?raw` into a shadow root), so an
 *      emitted asset means some CSS leaked into the *page* scope. That is not
 *      something a userscript may do: `@match *://*​/*` plus Tailwind Preflight
 *      would reset the layout of every site the user visits. So the asset is
 *      dropped, and anything non-trivial in it is reported as a build warning.
 *   2. Prepend the UserScript metadata block.
 *   3. Report the size, since install time is a real cost for a bundle this big.
 *
 * Run after `vite build --config vite.userscript.config.ts`.
 */

import { readFile, readdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { buildMetadata } from "./metadata.mjs"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const outDir = path.join(rootDir, "dist/userscript")
const rawBundlePath = path.join(outDir, "read-frog.raw.js")
const finalPath = path.join(outDir, "read-frog.user.js")

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function readVersion() {
  // CI appends a build counter so Tampermonkey sees a newer @version on every
  // publish; package.json's version tracks upstream, not this fork's builds.
  if (process.env.RF_USERSCRIPT_VERSION) return process.env.RF_USERSCRIPT_VERSION
  const pkg = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"))
  return pkg.version
}

/** Anything below this is almost certainly just Vite bookkeeping, not real rules. */
const CSS_LEAK_WARN_BYTES = 256

async function discardEmittedCss() {
  const entries = await readdir(outDir, { withFileTypes: true })
  const cssFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => path.join(outDir, entry.name))

  let total = 0
  for (const file of cssFiles) {
    total += Buffer.byteLength(await readFile(file, "utf8"))
    await rm(file)
  }
  return total
}

async function main() {
  if (!existsSync(rawBundlePath)) {
    console.error(
      `[build-userscript] ${path.relative(rootDir, rawBundlePath)} not found.\n` +
        `Run "vite build --config vite.userscript.config.ts" first.`,
    )
    process.exitCode = 1
    return
  }

  const version = await readVersion()
  const dashboardUrl = process.env.RF_DASHBOARD_URL ?? "https://rong6.github.io/read-frog/"

  const bundle = await readFile(rawBundlePath, "utf8")
  const leakedCssBytes = await discardEmittedCss()

  const metadata = buildMetadata({
    version,
    dashboardUrl,
    updateUrl: process.env.RF_UPDATE_URL,
    downloadUrl: process.env.RF_DOWNLOAD_URL,
  })

  const output = `${metadata}\n${bundle}`
  await writeFile(finalPath, output, "utf8")
  await rm(rawBundlePath)

  console.log(`[build-userscript] wrote ${path.relative(rootDir, finalPath)}`)
  console.log(`[build-userscript]   version   ${version}`)
  console.log(
    `[build-userscript]   dashboard ${dashboardUrl}`,
  )
  console.log(`[build-userscript]   size      ${formatSize(Buffer.byteLength(output))}`)
  if (leakedCssBytes > CSS_LEAK_WARN_BYTES) {
    console.warn(
      `[build-userscript] WARNING: discarded ${formatSize(leakedCssBytes)} of page-scope CSS.\n` +
        `[build-userscript] Something in the graph imports a stylesheet for its side effect. In a\n` +
        `[build-userscript] userscript that would style every site the user visits. Find the bare\n` +
        `[build-userscript] \`import "….css"\` and switch it to \`?inline\` injected into a shadow root.`,
    )
  }
}

await main()
