import { defineClientConfig } from "vuepress/client";
import UploadBox from "./components/UploadBox.vue";
import Workbench from "./components/Workbench.vue";

export default defineClientConfig({
    enhance: ({ app, router, siteData }) => {
        app.component("UploadBox", UploadBox);
        app.component("Workbench", Workbench);
    },
});
