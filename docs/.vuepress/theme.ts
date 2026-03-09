import { hopeTheme } from "vuepress-theme-hope";
import { Page } from "vuepress"
import navbar from "./navbar";

export default hopeTheme({
  hostname: "https://lrc.wuyilingwei.com",


  logo: "/logo.png",

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
      {
        text: "关于本站",
        icon: "material-symbols:info",
        prefix: "about/",
        collapsible: true,
        children: "structure",
      },
      "CONTRIBUTING",
    ],
  },

  // 禁用导航链接
  prevLink: false,
  nextLink: false,

  // 禁用页面目录
  toc: false,

  footer: `V宇宙词站
  <br>
    <a href="https://v2.vuepress.vuejs.org/" target="_blank">
      <img src="https://img.shields.io/badge/Powered%20by-Vuepress%20v2-3eaf7c?style=flat-square&logo=vuedotjs" alt="Powered by Vuepress v2">
    </a>
  <br>
    <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans" target="_blank">
      <img src="https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-ef9421?style=flat-square&logo=creativecommons&logoColor=white" alt="CC BY-NC-SA 4.0">
    </a>`,

  copyright: "Copyright © 2026-Now V宇宙词站及贡献者。<br><a href=\"/about/statement.html\" target=\"_blank\"> 《网站用户协议》</a>，使用本站即视为同意本协议。",

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