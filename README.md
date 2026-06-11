# Guofeng Brocade Interaction Engine

A browser-based interactive brocade weaving prototype. It converts uploaded motif images into a real-time warp-and-weft particle field, then reveals the brocade through a shuttle-like interaction.

## Features

- Single-page WebGL prototype using one HTML file and four JavaScript modules.
- Image-driven warp and weft particle generation.
- Dominant-color warp ground with image-faithful weft colors.
- Gesture-oriented shuttle interaction with pointer fallback.
- Subtle thread thickness and day/night surface controls.
- Orthographic rendering for stable 2D fabric interaction.
- Eight bundled motif examples in `example/`.

## Project Structure

```text
.
├── index.html
├── main.js
├── renderer.js
├── interactive.js
├── effect.js
└── example/
```

## Run Locally

Start a static server from the repository root:

```bash
python -m http.server 5173
```

Then open:

```text
http://127.0.0.1:5173/
```

Opening `index.html` directly may show only the initial page because the app uses ES modules and browser security rules for local files.

