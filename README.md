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

## Deploy

The included `.github/workflows/pages.yml` builds pull requests and deploys
pushes to `main`. In GitHub, choose **Settings → Pages → GitHub Actions** once.

## Deliberate omissions

This rewrite does not include calibration, pose tracking, labs, the Circle of
Fifths page, verbose file logging, or the hidden legacy games. Those remain in
the parent project while this version is evaluated.
