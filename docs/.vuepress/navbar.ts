import { navbar } from "vuepress-theme-hope";

export default navbar([
  "/",
  {
    text: "分类",
    icon: "material-symbols:label",
    link: "/category/",
  },
  {
    text: "参与贡献",
    icon: "material-symbols:person-add",
    link: "/CONTRIBUTING",
  },
  {
    text: "关于本站",
    icon: "material-symbols:info",
    link: "/about",
  },
  {
    text: "Github",
    icon: "mynaui:api-solid",
    link: "https://github.com/wuyilingwei/LRC"
  },
  {
    text: "迷迭香的小窝",
    icon: "material-symbols:book-2",
    link: "https://blog.wuyilingwei.com/"
  }
]);
