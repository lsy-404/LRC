import { navbar } from "vuepress-theme-hope";

export default navbar([
  "/",
  {
    text: "关于本站",
    icon: "line-md:plus-square-filled",
    link: "/about",
  },
  {
    text: "按标签浏览",
    icon: "material-symbols:label",
    link: "/tag/",
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
