import { navbar } from "vuepress-theme-hope";

export default navbar([
  "/",
  {
    text: "本站",
    icon: "line-md:plus-square-filled",
    prefix: "/",
    children: [
      "about",
      "statement",
    ]
  },
  /**{
    text: "文章",
    icon: "article",
    prefix: "/",
    children: [
      "/timeline/",
      "/category/",
      "/tag/",
    ]
  },*/
  {
    text: "API",
    icon: "mynaui:api-solid",
    link: "api"
  },
  {
    text: "迷迭香的小窝",
    icon: "line-md:cloud-alt-download-filled-loop",
    link: "https://blog.wuyilingwei.com/"
  }
]);
