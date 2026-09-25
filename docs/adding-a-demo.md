# Add one demo

Create `src/demos/BubblePop.jsx`:

```jsx
import { useRef, useState } from "react";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "bubble-pop",
  title: "Bubble Pop",
  kind: "GAME",
  description: "Pop bubbles with your fingertip.",
  instructions: "Move onto a bubble and pinch, click, touch, or press Space.",
};

export default function BubblePop({ inputRef, paused }) {
  const [score, setScore] = useState(0);
  const actionWasDown = useRef(false);

  useDemoFrame(() => {
    const input = inputRef.current;
    const actionStarted = input.action && !actionWasDown.current;
    actionWasDown.current = input.action;
    if (input.active && actionStarted) setScore((value) => value + 1);
  }, paused);

  return <div style={{ padding: 80, fontSize: 40 }}>Score {score}</div>;
}
```

The metadata needs a unique lowercase `id`, `title`, `description`, and
`instructions`. `kind`, `order`, and `icon` are optional.

`inputRef.current` contains:

| Field | Meaning |
| --- | --- |
| `active` | A hand or pointer is available. |
| `source` | `camera` or `pointer`. |
| `x`, `y` | Position from 0–1, origin at top-left. |
| `action` | Pinch, pointer press, or Space key. |
| `tips` | All visible camera fingertips; empty for pointer input. |

Coordinates are already mirrored. Use the elapsed-seconds argument from
`useDemoFrame` for movement, keep collections bounded, and clean up timers or
audio in React effect cleanup. Restart remounts the component.

Before opening a PR, run `npm run build`, try pointer controls, and record what
still needs testing with the event camera.
