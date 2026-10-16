import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";
import AutoImport from "astro-auto-import";
import { defineConfig } from "astro/config";
import remarkCollapse from "remark-collapse";
import remarkToc from "remark-toc";
import config from "./src/config/config.json";

// https://astro.build/config
export default defineConfig({
  site: config.site.base_url ? config.site.base_url : "http://examplesite.com",
  base: config.site.base_path ? config.site.base_path : "/",
  trailingSlash: config.site.trailing_slash ? "always" : "never",
  integrations: [
    react(),
    sitemap(),
    tailwind({
      config: {
        applyBaseStyles: false,
      },
    }),
    AutoImport({
      imports: [
        "@/shortcodes/Accordion",
        "@/shortcodes/Button",
        "@/components/Calendar.astro",
        "@/shortcodes/Notice",
        "@/shortcodes/Video",
        "@/shortcodes/Youtube",
        "@/shortcodes/Tabs",
        "@/shortcodes/Tab",
      ],
    }),
    mdx(),
  ],
  markdown: {
    remarkPlugins: [
      remarkToc,
      [
        remarkCollapse,
        {
          test: "Table of contents",
        },
      ],
    ],
    shikiConfig: {
      theme: "one-dark-pro",
      wrap: true,
    },
    extendDefaultPlugins: true,
  },
  vite: {
    // Prebundle React's runtimes up front. When Vite discovers them later, it
    // rebuilds its dependency cache mid-load and pages can fail with
    // "jsxDEV is not a function" until node_modules/.vite is cleared.
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    server: {
      proxy: {
        // Add routes here to proxy to Cloudflare Pages functions (those in the
        // 'functions' source directory)
        '^/calendar/.*': {
          target: 'http://localhost:8788',
          changeOrigin: true,
          secure: false,
        },
        '^/tree-recycling/.*': {
          target: 'http://localhost:8788',
          changeOrigin: true,
          secure: false,
        }
      }
    }
  }
});
