import { createFileRoute } from "@tanstack/react-router";
import { TermsOfServiceView } from "@/views/TermsOfServiceView";

export const Route = createFileRoute("/terms-of-service")({
  head: () => ({
    meta: [
      { title: "Brepia Viewer - Terms of Service Information" },
      {
        name: "description",
        content: "Information about the terms, open-source licensing, and use of the Brepia Viewer web application.",
      },
    ],
    links: [{ rel: "canonical", href: "https://viewer.notydesign.se/terms-of-service/" }],
  }),
  component: TermsOfServiceView,
});
