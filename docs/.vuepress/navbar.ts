import { navbar } from "vuepress-theme-hope";

export default navbar([
  "/",
  {
    text: "分类",
    icon: "material-symbols:label",
    prefix: "/",
    children: [
      "/category/",
      "/tag/",
    ],
  },
  {
    text: "关于本站",
    icon: "material-symbols:info",
    prefix: "about/",
    children: [
      "",
      "statement",
      "copyright",
    ],
  },
  {
    text: "参与贡献",
    icon: "material-symbols:person-add",
    children: [
      { text: "贡献指南", icon: "material-symbols:menu-book", link: "/contribute/" },
      { text: "工作站", icon: "material-symbols:cloud-upload", link: "/contribute/workstation" },
    ],
  },
  {
    text: "Github",
    icon: "mynaui:api-solid",
    link: "https://github.com/lsy-404/LRC"
  },
]);
