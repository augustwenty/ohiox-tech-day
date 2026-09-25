import { useState } from "react";
import { createGame, stepGame } from "../spaceInvadersGame.js";
import { useDemoFrame } from "../useDemoFrame.js";

export const demo = {
  id: "space-invaders",
  title: "Space Invaders",
  kind: "GAME",
  order: 1,
  icon: "👾",
  description: "Steer with your fingertip and pinch to defend Earth.",
  instructions: "Move left and right. Pinch, click, touch, or hold Space to fire.",
};

export default function SpaceInvaders({ inputRef, paused }) {
  const [game, setGame] = useState(createGame);

  useDemoFrame((seconds) => {
    const input = inputRef.current;
    if (input.active) setGame((state) => stepGame(state, seconds, input.x * 960, input.action));
  }, paused);

  return (
    <div className="invaders">
      <svg viewBox="0 0 960 600" preserveAspectRatio="none" aria-label="Space Invaders game field">
        {game.enemies.filter((enemy) => enemy.alive).map((enemy) => (
          <g key={enemy.id} transform={`translate(${enemy.x} ${enemy.y})`}>
            <rect width={enemy.width} height={enemy.height} rx="6" fill={enemy.row % 2 ? "#ff557f" : "#ffb84c"} />
            <circle cx="20" cy="16" r="4" fill="#101525" />
            <circle cx="42" cy="16" r="4" fill="#101525" />
          </g>
        ))}
        {game.playerShots.map((shot) => <rect key={shot.id} {...shot} rx="4" fill="#8fffea" />)}
        {game.enemyShots.map((shot) => <rect key={shot.id} {...shot} rx="4" fill="#ff557f" />)}
        <path
          d="M0 38 L14 12 L32 12 L41 0 L50 12 L68 12 L82 38 Z"
          transform={`translate(${game.ship.x - 41} ${game.ship.y - 19})`}
          fill="#58e6ad"
        />
      </svg>
      <div className="hud"><strong>Score {game.score}</strong><span>Invaders {game.enemies.filter((enemy) => enemy.alive).length}</span></div>
      {game.status !== "playing" ? <div className="result"><h2>{game.status === "cleared" ? "Wave cleared!" : "Game over"}</h2><p>{game.message}</p></div> : null}
    </div>
  );
}
