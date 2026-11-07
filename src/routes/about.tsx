import { Link, createFileRoute } from "@tanstack/react-router";

const canonical = "https://viewer.notydesign.se/about/";
const title = "About Brepia Viewer - Online OpenSCAD Editor and 3D Viewer";
const description =
  "Learn how to edit OpenSCAD .scad files, preview parametric models, export STL, and keep projects in your own browser with Brepia Viewer.";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Brepia Viewer" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: canonical },
      { property: "og:image", content: "https://viewer.notydesign.se/og-brepia-viewer.png" },
    ],
    links: [{ rel: "canonical", href: canonical }],
  }),
  component: AboutBrepiaViewer,
});

function AboutBrepiaViewer() {
  return (
    <main className="h-dvh overflow-y-auto bg-[#191a1a] text-adam-text-primary">
      <article className="mx-auto w-full max-w-3xl px-5 pb-20 pt-8 sm:px-8 sm:pt-14">
        <nav aria-label="Page navigation">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center text-sm text-adam-neutral-300 underline underline-offset-4 hover:text-adam-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-adam-blue"
          >
            Back to Brepia Viewer
          </Link>
        </nav>
        <header className="mt-7 border-b border-adam-neutral-700 pb-8">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Online OpenSCAD editor and 3D viewer
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-adam-neutral-300">
            Brepia Viewer is a free, open-source web application for exploring,
            editing, and previewing parametric OpenSCAD models. Open it in a
            desktop or mobile browser without installing a CAD application or
            creating an account.
          </p>
        </header>

        <section aria-labelledby="workflow-title" className="mt-9">
          <h2 id="workflow-title" className="text-xl font-semibold">
            From .scad file to 3D preview
          </h2>
          <ol className="mt-5 space-y-5 text-sm leading-7 text-adam-neutral-300">
            <li>
              <strong className="text-adam-text-primary">1. Open a project.</strong>{" "}
              Browse example models from public GitHub repositories, upload
              your own .scad file, or import an OpenSCAD project folder.
            </li>
            <li>
              <strong className="text-adam-text-primary">2. Edit and preview.</strong>{" "}
              Use the CodeMirror editor with syntax highlighting, autocomplete,
              search and replace, and OpenSCAD snippets. Adjust supported
              model parameters and render a 3D preview using OpenSCAD WebAssembly.
            </li>
            <li>
              <strong className="text-adam-text-primary">3. Save or export.</strong>{" "}
              Save your project in browser storage or download a supported export
              such as STL or OpenSCAD source.
            </li>
          </ol>
        </section>

        <section aria-labelledby="privacy-title" className="mt-10 border-t border-adam-neutral-700 pt-8">
          <h2 id="privacy-title" className="text-xl font-semibold">
            Where are projects saved?
          </h2>
          <p className="mt-3 text-sm leading-7 text-adam-neutral-300">
            Uploaded projects and edits are stored locally in IndexedDB in
            your browser, not in an online Brepia account. They do not
            automatically sync to another browser or device. Clearing browser
            data can remove your saved projects, so download copies you want
            to keep. Built-in models are fetched from public GitHub sources.
          </p>
        </section>

        <section aria-labelledby="questions-title" className="mt-10 border-t border-adam-neutral-700 pt-8">
          <h2 id="questions-title" className="text-xl font-semibold">
            Common questions
          </h2>
          <div className="mt-5 space-y-6 text-sm leading-7">
            <div>
              <h3 className="font-semibold">Do I need to install OpenSCAD?</h3>
              <p className="mt-1 text-adam-neutral-300">
                No. The web app runs the bundled OpenSCAD WebAssembly engine
                in your browser for model previews and supported exports.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Can I edit multiple .scad files?</h3>
              <p className="mt-1 text-adam-neutral-300">
                Yes. Import an OpenSCAD project folder and edit its source
                files, including supported use and include dependencies.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Does it work on a phone?</h3>
              <p className="mt-1 text-adam-neutral-300">
                Brepia Viewer has a mobile layout and an optional locked
                view that keeps the 3D preview visible while you scroll
                the editor and parameters.
              </p>
            </div>
          </div>
        </section>

        <footer className="mt-10 flex flex-wrap gap-x-6 gap-y-3 border-t border-adam-neutral-700 pt-6 text-sm">
          <Link to="/" className="text-adam-neutral-200 underline underline-offset-4">
            Open the viewer
          </Link>
          <a
            href="https://github.com/weaf/brepia_viewer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-adam-neutral-200 underline underline-offset-4"
          >
            Source code on GitHub
          </a>
          <Link to="/privacy-policy" className="text-adam-neutral-300 underline underline-offset-4">
            Privacy policy
          </Link>
          <Link to="/terms-of-service" className="text-adam-neutral-300 underline underline-offset-4">
            Terms of service
          </Link>
        </footer>
      </article>
    </main>
  );
}
