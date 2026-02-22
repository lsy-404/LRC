import { hopeTheme } from "vuepress-theme-hope";
import { Page } from "vuepress"
import navbar from "./navbar";

export default hopeTheme({
  hostname: "https://lrc.wuyilingwei.com",

  author: {
    name: "武乙凌薇",
    url: "https://github.com/wuyilingwei",
    avatar: "/logo.jpg",
  },

  logo: "/logo.jpg",

  // print button
  print: false,

  //enable full screen button
  fullscreen: false,

  lastUpdated: false,
  contributors: false,
  editLink: false,

  docsDir: "docs",

  markdown: {
    attrs: true,
    align: true,
    sub: true,
    sup: true,
    footnote: true,
  },

  // navbar
  navbar: navbar,

  // sidebar
  sidebar: {
    "/": [
      "",
      {
        text: "专辑列表",
        icon: "material-symbols:album",
        prefix: "albums/",
        collapsible: true,
        children: "structure",
      },
      "about",
    ],
  },

  // 禁用导航链接
  prevLink: false,
  nextLink: false,

  // 禁用页面目录
  toc: false,

  footer: `V宇宙词站<br>Powered by <a href="https://v2.vuepress.vuejs.org/" target="_blank"><b>Vuepress</b></a> v2`,

  copyright: "Copyright © 2026-Now All rights reserved.",

  displayFooter: true,

  pageInfo: ["Tag"],

  plugins: {
    // 启用博客插件以支持 /tag/ 聚合页
    blog: true,

    // 图标资源
    icon: {
      assets: "iconify",
    },

    // 歌词网站不需要评论功能
    comment: false,

    // 搜索配置
    slimsearch: {
      indexContent: true,
    },

    // Markdown增强已移至 markdown 配置中
  },
},
  {
    custom: true
  });