import { defineUserConfig } from "vuepress";
import theme from "./theme";
import { viteBundler } from '@vuepress/bundler-vite';

export default defineUserConfig({
  lang: "zh-CN",
  title: "虚拟歌姬 LRC 歌词分享",
  description: "虚拟歌姬官方/第三方专辑的 LRC 歌词文件储存与共享",
  base: "/",
  shouldPrefetch: false,
  theme, // 使用主题
  bundler: viteBundler({
    // ... Vite 特定的配置 ...
  }),
  head: [
    ['link', { rel: 'icon', href: '/logo.svg', type: "image/svg+xml", sizes: "any" }],
    ['link', { rel: 'icon', href: '/logo.png' }],
    ['link', { rel: 'manifest', href: '/manifest.json' }],
    ['meta', { name: 'theme-color', content: '#f7b5c0' }], // 主题色
    ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
    ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }],
    ['link', { rel: 'apple-touch-icon', href: '/icon/apple-touch-icon-152x152.png' }],
    ['link', { rel: 'mask-icon', href: '/eod.svg', color: '#FFFFFF' }],
    ['meta', { name: 'msapplication-TileImage', content: '/icon/msapplication-icon-144x144.png' }],
    ['meta', { name: 'msapplication-TileColor', content: '#f7b5c0' }], // 磁贴颜色
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://unpkg.com/lxgw-wenkai-screen-webfont@1.6.0/style.css",
      }
    ],
  ],

  // 插件配置移至theme.ts中
  // plugins: [],
});