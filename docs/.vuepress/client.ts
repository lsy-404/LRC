import { defineClientConfig } from "vuepress/client";
import UploadBox from "./components/UploadBox.vue";

export default defineClientConfig({
    enhance: ({ app, router, siteData }) => {
        app.component("UploadBox", UploadBox);
    },
});
