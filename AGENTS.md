# Workshop agent instructions

Read `README.md` and `docs/adding-a-demo.md` before editing.

- For an ordinary activity, create exactly one file at `src/demos/<Name>.jsx`.
- Export `demo` metadata and a default React component.
- Use the supplied `inputRef` and `useDemoFrame`; never open another camera stream.
- Include one clear interaction and feedback. Camera and pointer input must both work.
- Keep styles inside the demo component unless shared infrastructure truly needs a change.
- Do not add a backend, accounts, secrets, uploads, recording, analytics, microphone access, or a large dependency.
- Preserve Space Invaders, Voronoi, the input contract, and camera cleanup.
- Run `npm run build` and state what still needs a real-camera test.
