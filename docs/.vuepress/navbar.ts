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
    link: "/CONTRIBUTING",
  },
  {
    text: "Github",
    icon: "mynaui:api-solid",
    link: "https://github.com/wuyilingwei/LRC"
  },
]);
