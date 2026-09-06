import { defineClientConfig } from "vuepress/client";
import Workbench from "./components/Workbench.vue";

export default defineClientConfig({
    enhance: ({ app, router, siteData }) => {
        app.component("Workbench", Workbench);
    },
});
