import { defineConfig } from 'vitepress'

import enPackagesSidebar from './sidebars/en/packages.mjs'
import zhPackagesSidebar from './sidebars/zh/packages.mjs'
import {
  aimdInjection,
  aimdLanguage,
} from '../../packages/aimd-core/src/syntax/aimd-grammar.ts'

const normalizeBasePath = (basePath) => {
  if (!basePath || basePath === '/') return '/'

  let normalized = basePath
  if (!normalized.startsWith('/')) normalized = `/${normalized}`
  if (!normalized.endsWith('/')) normalized = `${normalized}/`

  return normalized.replace(/\/{2,}/g, '/')
}

const inferBasePathFromGitHub = () => {
  const repository = process.env.GITHUB_REPOSITORY
  const owner = process.env.GITHUB_REPOSITORY_OWNER
  if (!repository || !owner) return '/'

  const [, repoName] = repository.split('/')
  if (!repoName) return '/'

  return repoName === `${owner}.github.io` ? '/' : `/${repoName}/`
}

const base = normalizeBasePath(process.env.BASE_PATH || inferBasePathFromGitHub())
const githubLink = 'https://github.com/airalogy/aimd'
const legacyDemoHashRedirectScript = `(() => {
  const { hash, search } = window.location
  const match = hash.match(/^#\\/demo(?:\\/(.*))?\\/?$/)
  if (!match) return

  const route = match[1]
    ? \`#/\${match[1].replace(/^\\/+|\\/+$/g, '')}\`
    : ''

  window.location.replace(${JSON.stringify(base)} + 'demo/' + search + route)
})()`

const enRootSidebar = [
  {
    text: 'Packages',
    link: '/en/packages/',
    collapsed: false,
    items: enPackagesSidebar.flatMap(group => group.items ?? []),
  },
]

const zhRootSidebar = [
  {
    text: '包文档',
    link: '/zh/packages/',
    collapsed: false,
    items: zhPackagesSidebar.flatMap(group => group.items ?? []),
  },
]

const enSidebar = {
  '/en/': enRootSidebar,
  '/en/packages/': enPackagesSidebar,
}

const zhSidebar = {
  '/zh/': zhRootSidebar,
  '/zh/packages/': zhPackagesSidebar,
}

export default defineConfig({
  title: 'AIMD',
  lang: 'en-US',
  description: 'AIMD package documentation',
  base,
  head: [
    ['script', {}, legacyDemoHashRedirectScript],
  ],
  ignoreDeadLinks: [
    /^\/demo(?:\/index)?(?:\/)?$/,
  ],
  locales: {
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Packages', link: '/en/packages/' },
          { text: 'Demo', link: '/en/demo' },
        ],
        sidebar: enSidebar,
      },
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        nav: [
          { text: '首页', link: '/zh/' },
          { text: '包文档', link: '/zh/packages/' },
          { text: '演示', link: '/zh/demo' },
        ],
        sidebar: zhSidebar,
      },
    },
  },
  themeConfig: {
    search: {
      provider: 'local',
    },
    socialLinks: [
      { icon: 'github', link: githubLink },
    ],
  },
  markdown: {
    languages: [
      aimdLanguage,
      aimdInjection,
    ],
    lineNumbers: false,
    config(md) {
      const defaultRender =
        md.renderer.rules.code_inline
        || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))

      md.renderer.rules.code_inline = (tokens, idx, options, env, self) => {
        const html = defaultRender(tokens, idx, options, env, self)
        return html.replace('<code', '<code v-pre')
      }
    },
  },
})
