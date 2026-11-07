import { createFileRoute } from "@tanstack/react-router";
import { ModelGalleryView } from "@/views/ModelGalleryView";

const title = "Brepia Viewer - Free Online OpenSCAD Editor & 3D Viewer";
const description =
  "Free online OpenSCAD editor and 3D viewer. Edit .scad files with syntax highlighting, preview parametric models, export STL, and save projects locally in your browser.";
const canonical = "https://viewer.notydesign.se/";
const image = "https://viewer.notydesign.se/og-brepia-viewer.png";

const appSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Brepia Viewer",
  description,
  url: canonical,
  image,
  applicationCategory: "DesignApplication",
  operatingSystem: "Modern desktop and mobile browsers",
  browserRequirements: "JavaScript and WebAssembly",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://github.com/weaf/brepia_viewer/blob/main/LICENSE",
  sameAs: "https://github.com/weaf/brepia_viewer",
  featureList: [
    "OpenSCAD source editing with syntax highlighting and autocomplete",
    "Parametric 3D model preview powered by OpenSCAD WebAssembly",
    "Edit .scad project files and source dependencies",
    "Adjust exposed model parameters",
    "Export STL files",
    "Store imported projects locally in browser storage",
  ],
};

export const Route = createFileRoute("/_layout/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "index, follow, max-image-preview:large" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Brepia Viewer" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: canonical },
      { property: "og:image", content: image },
      { property: "og:image:alt", content: "Brepia Viewer online OpenSCAD editor and 3D viewer" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image },
    ],
    links: [{ rel: "canonical", href: canonical }],
    scripts: [{ type: "application/ld+json", children: JSON.stringify(appSchema) }],
  }),
  component: ModelGalleryView,
});
