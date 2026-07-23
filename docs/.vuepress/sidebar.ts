import { sidebar } from "vuepress-theme-hope";

export default sidebar({
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
    {
      text: "参与贡献",
      icon: "material-symbols:person-add",
      collapsible: true,
      children: [
        { text: "贡献指南", link: "/contribute/" },
        { text: "工具", link: "/upload/" },
      ],
    },
  ],
},);