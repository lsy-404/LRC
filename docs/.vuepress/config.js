import { defineUserConfig } from 'vuepress'
import { viteBundler } from '@vuepress/bundler-vite'

export default defineUserConfig({
  bundler: viteBundler(),
  lang: 'zh-CN',
  title: 'LRC Albums',
  description: 'Collection of LRC lyrics files organized by albums',
  theme: 'default',
  base: '/',
  head: [
    ['meta', { name: 'keywords', content: 'LRC, lyrics, albums, music' }],
  ],
  themeConfig: {
    sidebar: 'auto',
  },
})