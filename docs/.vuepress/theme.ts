import { hopeTheme } from "vuepress-theme-hope";
import { Page } from "vuepress"
import navbar from "./navbar";

export default hopeTheme({
  hostname: "https://lrc.wuyilingwei.com",

  author: {
    name: "武乙凌薇",
    url: "https://github.com/wuyilingwei",
  },

  iconAssets: "iconify",

  logo: "/logo.svg",

  // print button
  print: false,

  //enable full screen button
  fullscreen: true,

  lastUpdated: false,
  contributors: false,
  editLink: false,

  docsDir: "docs",

  markdown: {
    attrs: true,
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

  footer: `中术 LRC 歌词分享 - 所有歌词版权归原作者或版权所有方所有<br>Powered by <a href="https://v2.vuepress.vuejs.org/" target="_blank"><b>Vuepress</b></a> v2`,

  copyright: "Copyright © 2023-Now All rights reserved.",

  displayFooter: true,

  pageInfo: [],

  // 歌词网站不需要博客功能
  blog: false,

  plugins: {
    // 歌词网站不需要评论功能
    comment: false,

    // 搜索配置
    slimsearch: {
      indexContent: true,
    },

    // Markdown增强 - 保留基础格式化功能
    mdEnhance: {
      attrs: true,      // 属性支持
      sub: true,        // 下标
      sup: true,        // 上标
      footnote: true,   // 脚注
      align: true,      // 对齐
    },
  },
},
  {
    custom: true
  });