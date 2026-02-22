import { defineUserConfig } from "vuepress";
import theme from "./theme";
import { viteBundler } from '@vuepress/bundler-vite';

export default defineUserConfig({
  lang: "zh-CN",
  title: "V宇宙词站",
  description: "虚拟歌姬专辑的信息导航与歌词共享",
  base: "/",
  shouldPrefetch: false,
  theme, // 使用主题
  bundler: viteBundler({
    // ... Vite 特定的配置 ...
  }),
  head: [
    [
      "link",
      {
        rel: "icon",
        href: "/logo.png",
      }
    ],
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