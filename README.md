# MoCaKa

## Echo Caves

Moka the bat is lost in pitch-black caves. Squeak to send out a ring of sound that lights up the walls for a moment, but every squeak also wakes whatever is sleeping nearby: spiders drop on their threads, loose rocks fall, and owls give chase.

Collect the glowing moths and fly to the green light. You earn one star for escaping, one for finding every moth, and one for using no more squeaks than par.

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
- `src/level.js` contains the cave maps, drawn as text with one character per tile. The key is at the top of the file.
- `src/style.css` styles the menus and overlays.
