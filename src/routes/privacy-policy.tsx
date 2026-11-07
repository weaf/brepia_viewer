import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPolicyView } from "@/views/PrivacyPolicyView";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [
      { title: "Brepia Viewer - Privacy Policy Information" },
      {
        name: "description",
        content: "Privacy information for the Brepia Viewer web application and its browser-local model storage.",
      },
    ],
    links: [{ rel: "canonical", href: "https://viewer.notydesign.se/privacy-policy/" }],
  }),
  component: PrivacyPolicyView,
});
