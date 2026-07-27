/**
 * UserScript metadata block.
 *
 * `@connect` matters more than it looks: Tampermonkey gates GM_xmlhttpRequest on
 * it, so every host the app might call — every AI provider, the translation
 * services, the Read Frog API, Google, and whatever custom/self-hosted endpoint
 * or WebDAV server the user configures — has to be reachable. The wildcard
 * covers user-supplied hosts (custom OpenAI-compatible base URLs, Ollama on the
 * LAN, arbitrary WebDAV) which cannot be enumerated ahead of time; the explicit
 * entries above it exist so the manager's permission prompt shows recognisable
 * names rather than a bare `*`.
 */

/** Hosts the built-in providers use. Keep in sync with src/utils/constants/providers.ts. */
export const KNOWN_CONNECT_HOSTS = [
  // Read Frog services
  "api.readfrog.app",
  "readfrog.app",
  "www.readfrog.app",
  // LLM providers
  "api.openai.com",
  "api.anthropic.com",
  "api.deepseek.com",
  "generativelanguage.googleapis.com",
  "openrouter.ai",
  "api.siliconflow.cn",
  "api.x.ai",
  "api.groq.com",
  "api.mistral.ai",
  "api.together.xyz",
  "api.cohere.com",
  "api.fireworks.ai",
  "api.cerebras.ai",
  "api.replicate.com",
  "api.perplexity.ai",
  "api.deepinfra.com",
  "api.moonshot.cn",
  "api.minimax.chat",
  "ark.cn-beijing.volces.com",
  "dashscope.aliyuncs.com",
  "router.huggingface.co",
  "api.vercel.com",
  "bedrock-runtime.us-east-1.amazonaws.com",
  "openai.azure.com",
  "localhost",
  "127.0.0.1",
  // Non-LLM translation services
  "translate.googleapis.com",
  "translate.google.com",
  "api-free.deepl.com",
  "api.deepl.com",
  "api.cognitive.microsofttranslator.com",
  "edge.microsoft.com",
  // Speech
  "speech.platform.bing.com",
  // Sync + assets
  "www.googleapis.com",
  "oauth2.googleapis.com",
  "accounts.google.com",
  "api.iconify.design",
  // Provider logos (@lobehub/icons-static-webp). `@connect *` below would cover
  // it, but managers can be configured to prompt for anything not named here,
  // and a prompt the user never sees looks exactly like a broken icon.
  "registry.npmmirror.com",
  "unpkg.com",
  "cdn.jsdelivr.net",
  // Video subtitles
  "www.youtube.com",
  "youtube.com",
]

export function buildMetadata({ version, dashboardUrl, updateUrl, downloadUrl }) {
  const dashboardMatch = (() => {
    try {
      const url = new URL(dashboardUrl)
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}/*`
    } catch {
      return null
    }
  })()

  const lines = [
    "// ==UserScript==",
    "// @name         Read Frog",
    "// @name:zh-CN   陪读蛙",
    "// @namespace    https://readfrog.app",
    `// @version      ${version}`,
    "// @description  Immersive AI translation and language learning, ported from the Read Frog browser extension.",
    "// @description:zh-CN  沉浸式 AI 翻译与语言学习，由 Read Frog 浏览器扩展移植。",
    "// @author       Read Frog contributors (userscript port)",
    "// @license      GPL-3.0",
    "// @homepageURL  https://readfrog.app",
    "// @supportURL   https://github.com/rong6/read-frog/issues",
    updateUrl ? `// @updateURL    ${updateUrl}` : null,
    downloadUrl ? `// @downloadURL  ${downloadUrl}` : null,
    "// @match        *://*/*",
    // host/side/selection all declare `file:///*`; without this the script is
    // never injected there and local-file translation silently disappears.
    "// @match        file:///*",
    dashboardMatch ? `// @match        ${dashboardMatch}` : null,
    "// @grant        GM_xmlhttpRequest",
    "// @grant        GM_getValue",
    "// @grant        GM_setValue",
    "// @grant        GM_deleteValue",
    "// @grant        GM_listValues",
    "// @grant        GM_addValueChangeListener",
    "// @grant        GM_removeValueChangeListener",
    "// @grant        GM_registerMenuCommand",
    "// @grant        GM_unregisterMenuCommand",
    "// @grant        GM_addStyle",
    "// @grant        GM_openInTab",
    "// @grant        GM_setClipboard",
    "// @grant        GM_info",
    "// @grant        unsafeWindow",
    ...KNOWN_CONNECT_HOSTS.map((host) => `// @connect      ${host}`),
    "// @connect      *",
    // document-start because interceptor.content and input-injector.content must
    // patch page globals before the page's own scripts run.
    "// @run-at       document-start",
    "// ==/UserScript==",
    "",
  ]

  return lines.filter((line) => line !== null).join("\n")
}
