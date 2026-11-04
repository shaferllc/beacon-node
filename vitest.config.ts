import { defineConfig } from "vitest/config";

// Own config so vitest doesn't walk up and load the app's vite.config.js (needs vite + laravel plugin).
export default defineConfig({});
