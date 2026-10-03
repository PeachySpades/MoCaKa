# MoCaKa

## Echo Caves

Moka the bat is lost in pitch-black caves. Squeak to send out a ring of sound that lights up the walls for a moment, but every squeak also wakes whatever is sleeping nearby: spiders drop on their threads, loose rocks fall, and owls give chase.

Echoes are limited. Each cave gives Moka a set number of squeaks, and glowing crystals add 3 more. When you run out, you fly blind.

### Modes

- **Explore**: a hand-made cave. Collect the glowing moths and fly to the green light. You earn one star for escaping, one for finding every moth, and one for finishing with enough echoes left.
- **Cave Run**: an endless side-scroller. The screen scrolls right on its own and speeds up over time. If a wall pins Moka against the left edge, the dark catches you. Each run is a newly generated tunnel, and your best distance is saved.
- **Battle (Bat Brawl)**: 2 to 4 bats in a pitch-black arena. You can't see walls, rivals or pickups until sound lights them up, and squeaking also gives away where you are. Hit a rival with a squeak to stun them, then fly into them for a bite (with a chomp-and-burp animation). First to 3 bites wins. Every 25 seconds the cave shifts into a different themed arena: Crystal Grotto, Lava Hollow, Mossy Den or Frozen Cavern. About one shift in three opens onto Open Sky instead: no cave walls at all, just a starry night. Each device controls one bat: you are Mo, and you fill the other roosts with CPU bats (or play friends Online, one device each). On a keyboard, fly with WASD or the arrow keys, squeak with F, Space or Enter, and dash with G.
  - **3D or 2D**: battles are drawn in 3D by default, with a camera that follows your bat so the cave fills the screen. Switch to the flat top-down view on the setup screen or from the pause menu.
  - **Arena modes**: Shifting (the cave jumps to a new arena every 25 seconds), Morphing (the cave slowly reshapes itself, a few walls at a time, into the next arena), Chaos (a new arena every 9 seconds) or Open Sky (no cave at all).
  - **CPU levels**: Easy, Normal or Hard. CPU bats play fair: they only know where you are when sound reveals you, you squeak or dash nearby, or you're right next to them; otherwise they hunt from where they last noticed you.
  - **Music and sound**: every mode has its own jazz tune (piano, walking bass, brushes and vibes) plus sounds for stuns, blocks, power-ups and the countdown, all synthesized in the browser. The ♪ button in the bottom-left corner turns sound on or off.
  - **Sonic beam**: hold squeak (the squeak key, or a second finger on a touch screen), then let go to fire a long, narrow beam the way you're flying. It reaches much farther than a squeak ring and stuns longer, but costs 2 echoes and only hits what's straight ahead. Letting go early just squeaks.
  - **Dash**: a quick burst of speed with a short cooldown. Flick your finger, press the DASH button, or use the dash key.
  - **Power-ups** appear in the dark every few seconds: Mega Screech (your next squeak is huge and stuns longer), Speed (6 seconds), Shield (blocks one stun) and Echo Frenzy (5 seconds of free, rapid squeaks).
- **Online**: battle friends on other devices. One player taps Create room and shares the 4-letter code; the others type it in (or open the game with `?room=CODE`). The host can fill empty seats with CPU bats. If someone leaves mid-match, a CPU bat takes over.

### Controls

| | Phone / tablet | Computer |
|---|---|---|
| Fly | Drag anywhere | Arrow keys or WASD, or drag with the mouse |
| Squeak | Tap, or tap with a second finger while dragging | Space, or click |

The game is designed for phones held sideways and also runs in any desktop browser.

### Running it

There is no build step. Open `index.html` in a browser, or serve the folder with any static file server:

```sh
npx serve .
```

### Layout

- `index.html` contains the page, menus and meta tags for adding to the home screen.
- `src/game.js` contains the game loop, input, hazards and rendering on a single canvas.
- `src/level.js` contains the Explore cave maps, drawn as text with one character per tile (the key is at the top of the file), and the Cave Run tunnel generator.
- `src/arenas.js` contains the Bat Brawl arena maps and their color themes.
- `src/duel.js` contains Bat Brawl: stun and eat rules, the eating animation, arena shifts, touch controls, the CPU bats and the 2D view.
- `src/view3d.js` draws the game in 3D with three.js: Bat Brawl with a chase camera, and Explore and Cave Run as a cave cross-section with depth. The rules stay in `duel.js` and `game.js`.
- `src/net.js` contains online rooms: room codes, the lobby, and the connection between players.
- `src/vendor/peerjs.min.js` is PeerJS 1.5.5 (MIT), loaded only when you open Online.
- `src/vendor/three.min.js` is three.js r158 (MIT), used for the 3D battle view.
- `src/style.css` styles the menus and overlays.

### How online works

The host's browser runs the match and sends snapshots to everyone about 20 times a second; guests send their stick and button presses back. Players connect directly over WebRTC using [PeerJS](https://peerjs.com/), and the free public PeerJS server is only used to find each other by room code. A few strict networks (some school or office Wi‑Fi) block direct connections; switching to mobile data usually fixes that.

Online needs the game served from a real web address (for example Netlify or GitHub Pages); it does not work from a local file. To try it on one computer, open two tabs with `?net=local`, which connects tabs through the browser instead of the network.
