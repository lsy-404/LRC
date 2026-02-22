import { navbar } from "vuepress-theme-hope";

export default navbar([
  "/",
  {
    text: "标签列表",
    icon: "material-symbols:label",
    link: "/tag/",
  },
  {
    text: "关于本站",
    icon: "line-md:plus-square-filled",
    link: "/about",
  },
  {
    text: "参与贡献",
    icon: "material-symbols:person-add",
    link: "/contributing",
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
