# Minimal Webcam Workshop

This is a standalone rewrite of the workshop surface in the parent repository.
It intentionally contains only:

- a launcher;
- Space Invaders and Voronoi;
- shared webcam, pointer, touch, and keyboard input;
- Home, Pause, Restart, and Fullscreen controls; and
- automatic discovery of one-file demos.

Camera frames are processed locally and are never uploaded or recorded.

## Run it

Requires Node.js 20 and npm.

```sh
npm ci
npm run dev
```

Camera access requires HTTPS or localhost. The hand model loads MediaPipe assets
from jsDelivr when tracking starts. If camera permission or tracking fails,
choose **Pointer / keys**.

## Add a demo

Create one `.jsx` file in `src/demos/`. It appears in the launcher without any
menu or route changes. See [docs/adding-a-demo.md](docs/adding-a-demo.md).

## Workshop display laptop

Use the local development server for the live workshop. It avoids waiting for a
hosted deployment and keeps camera access on `localhost`:

```sh
npm ci
npm run dev
```

Leave the server running. After a demo is merged to `main`, update the display
laptop in another terminal:

```sh
git pull --ff-only
```

Vite will usually notice the updated source automatically; refresh the browser
if it does not. If `package-lock.json` changed, stop the server, run `npm ci`,
and start it again. Ordinary one-file demo PRs should not change dependencies.

## CI and Pages

The included `.github/workflows/pages.yml` installs dependencies, runs tests,
and builds every pull request targeting `main`. After a change reaches `main`,
the same workflow also deploys the build to GitHub Pages as a convenient hosted
copy. The local display laptop does not need to wait for that deployment.

To enable the hosted copy, choose **Settings → Pages → GitHub Actions** once in
GitHub. Pages is optional; pull-request checks work without using the Pages URL.

## Deliberate omissions

This rewrite does not include calibration, pose tracking, labs, the Circle of
Fifths page, verbose file logging, or the hidden legacy games. Those remain in
the parent project while this version is evaluated.
