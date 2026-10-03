# MoCaKa

## Echo Caves

Moka the bat is lost in pitch-black caves. Squeak to send out a ring of sound that lights up the walls for a moment, but every squeak also wakes whatever is sleeping nearby: spiders drop on their threads, loose rocks fall, and owls give chase.

Echoes are limited. Each cave gives Moka a set number of squeaks, and glowing crystals add 3 more. When you run out, you fly blind.

### Modes

- **Explore**: three long hand-made caves (First Flight, The Hollows, Owl Deep), each harder than the last. Collect the glowing moths and fly to the green light. You earn one star per cave for escaping, one for finding every moth, and one for finishing with enough echoes left. Play picks up at the next cave you haven't beaten. Each cave has a lantern checkpoint (cave 3 has two): light it by flying past, and if you lose after that, "Back to checkpoint" puts you there with full hearts and at least 6 echoes. Two extra hearts are hidden in hard-to-reach spots in every cave, each adding a heart (up to 5).
- **Cave Run**: an endless side-scroller. The screen scrolls right on its own and speeds up over time. If a wall pins Moka against the left edge, the dark catches you. Each run is a newly generated tunnel, and your best distance is saved. Explore and Cave Run both have the same dash as Battle (DASH button, a quick flick, or G/Shift).
- **Multiplayer**: the title's Multiplayer card opens three games, **Bites**, **Last Bite** and **Co-op Run**, which all lead to one lobby. The lobby has tabs to switch games, four seats (you, friends, CPU bats with their own Easy/Normal/Hard setting, or an empty seat to add a CPU or invite a friend), a **My bat** panel with your bat in 3D and a **Rules** panel, the room code bar, and the Let's Fight button.
- **Bat creator**: "Customize bat" opens a Lego-style creator. Slide left and right through 9 parts (bat type, colours, ears, wings, eyes, hat, face extra, pattern and trail) with over 100 options, and drag the 3D bat to spin it. Your bat is saved on the device and used in every mode, and friends online see it too.
- **Battle (Bat Brawl)**: 2 to 4 bats in a pitch-black arena. You can't see walls, rivals or pickups until sound lights them up, and squeaking also gives away where you are. Dash into a rival to bite them (a big snapping mouth, slash marks and a crunch). A squeak stuns rivals, and a stunned bat can't dash or parry, so stun-then-dash is the safe play. Two ways to win: **Bites** (first to 3, 5 or 7 bites) or **Last bat** (a chomped bat is out for the round; the last bat flying wins the round, first to 3, 5 or 7 round wins; after 90 seconds an echo storm lights everyone up). Pick the arena: Morphing (the walls slowly reshape between the four caves), one of the caves kept still all match (Crystal Grotto, Lava Hollow, Mossy Den or Frozen Cavern), or Open Sky (no walls, just a starry night). Each device controls one bat: you are Mo, and you fill the other seats with CPU bats or with friends online, one device each. On a keyboard, fly with WASD or the arrow keys, squeak with F, Space or Enter, and dash with G.
  - **3D or 2D**: battles are drawn in 3D by default, with a camera that follows your bat so the cave fills the screen. Switch to the flat top-down view on the setup screen or from the pause menu.
  - **CPU levels**: Easy, Normal or Hard. CPU bats play fair: they only know where you are when sound reveals you, you squeak or dash nearby, or you're right next to them; otherwise they hunt from where they last noticed you.
  - **Music and sound**: every mode has its own upbeat jazz tune played by a full band (trumpet, saxes and trombone, piano, walking bass, guitar, vibes and drums) plus sounds for stuns, blocks, power-ups and the countdown, all synthesized in the browser. The ♪ button in the bottom-left corner turns sound on or off.
  - **Sonic beam**: hold squeak (the squeak key, or a second finger on a touch screen), then let go to fire a long, narrow beam the way you're flying. It reaches much farther than a squeak ring and stuns longer, but costs 2 echoes and only hits what's straight ahead. Letting go early just squeaks.
  - **Dash**: a quick burst of speed with a short cooldown, and the only way to bite. Flick your finger, press the DASH button, or use the dash key. Two bats dashing into each other bounce apart.
  - **Parry**: squeak just as a rival's squeak, beam or dash reaches you. You shrug it off, they get stunned, and your squeak is free.
  - **Power-ups** appear in the dark every few seconds: Mega Screech (your next squeak is huge and stuns longer), Speed (6 seconds), Shield (blocks one stun) and Echo Frenzy (5 seconds of free, rapid squeaks). Special power-ups are held until you press the POWER button (E or Q on a keyboard): Fireball, Thunder (strikes nearby rivals from the sky), Stone Wall (raises a wall behind you for 6 seconds), Freeze, Tornado (pulls rivals in) and Ghost (fly through walls for 5 seconds). In the lobby's Rules panel, Power-ups lets you choose which ones appear and how often (Off, Low, Normal or High).
- **Co-op Run** (Multiplayer → Co-op Run): 1 to 4 bats fly a long dark side-scrolling level together while spiders, owls, cave crawlers and ghost moths hunt them. Squeak to stun monsters, dash to smash them. Each bat has 3 hearts; knocked-out bats come back when a teammate reaches the next lantern, and if everyone goes down the team restarts from the last lantern (3 tries). Add CPU buddies or play with friends online. CPU buddies are helpers, not carries: they react late, sometimes fumble a squeak or a dash and get knocked out now and then, so a team of only CPUs rarely gets out. The Monsters level sets how tough the monsters are, and each buddy plays at its own seat's level. Three ways to play:
  - **Classic**: the run above.
  - **Escape**: monsters can't be destroyed. A squeak only dazes them for a moment and shoves them back, extra ghost moths and owls keep chasing the team, and the screen scrolls a little faster.
  - **Hunt**: smash monsters for points. New monsters arrive in waves, quick kills in a row build a combo (up to ×5), and the run ends when the 2:30 clock runs out or someone reaches the green light (seconds left become bonus points). Push against the right edge to make the screen scroll faster. The end screen shows the team score and the best hunter.
- **Online** (in the Multiplayer lobby): one player taps Create room and shares the 4-letter code or the copied link; the others type the code (or open the link). The host picks the arena, match length and CPU bats for empty seats. If someone leaves mid-match, a CPU bat takes over.

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
- `src/duel.js` contains Bat Brawl: stun and eat rules, the eating animation, arena modes and Last Bat Standing rounds, touch controls, the CPU bats and the 2D view.
- `src/view3d.js` draws the game in 3D with three.js: Bat Brawl with a chase camera, and Explore and Cave Run as a cave cross-section with depth. The rules stay in `duel.js` and `game.js`.
- `src/coop.js` is Co-op Run (its levels come from `makeCoopLevel` in `src/level.js`).
- `src/net.js` contains online rooms: room codes, the lobby, and the connection between players.
- `server/rooms.js` and `wrangler.jsonc` are the Cloudflare Worker that serves the game and runs online rooms.
- `src/vendor/peerjs.min.js` is PeerJS 1.5.5 (MIT), loaded only when you open Online.
- `src/vendor/three.min.js` is three.js r158 (MIT), used for the 3D battle view.
- `src/looks.js` is the bat creator and bat looks: every part, 2D and 3D bat drawing, and the editor.
- `src/backdrop.js` paints the cave behind the menus, and `src/cardart.js` paints the illustrated menu cards.
- `src/music.js` is the synthesized jazz band: four 32-bar tunes, one per mode.
- `src/style.css` styles the menus and overlays.

### How online works

The host's browser runs the match and sends snapshots to everyone about 20 times a second; guests send their stick and button presses back. When the game runs on Cloudflare (see below), messages go through a small room server, which works on any network. Otherwise players connect directly over WebRTC using [PeerJS](https://peerjs.com/), and the free public PeerJS server is only used to find each other by room code. A few strict networks (some school or office Wi‑Fi) block direct connections; switching to mobile data usually fixes that.

### Cloudflare

The repo deploys as one Cloudflare Worker: it serves the game and gives each room code a Durable Object that relays messages between players. In the Cloudflare dashboard, go to Workers & Pages, choose Create, then Import a repository, and pick this repo (deploy command `npx wrangler deploy`). The game then lives at `https://mocaka.<your-subdomain>.workers.dev` and uses its own room server automatically. Copies hosted elsewhere use it once `ROOM_SERVER` in `src/net.js` is set to that address; `?relay=<address>` does the same for one visit. Locally, `npx wrangler dev` runs the whole thing.

Online needs the game served from a real web address (for example Netlify or GitHub Pages); it does not work from a local file. To try it on one computer, open two tabs with `?net=local`, which connects tabs through the browser instead of the network.
