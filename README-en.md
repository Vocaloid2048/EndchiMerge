# EndchiMerge - 方團團大作戰

> *"Stack two identical dumplings and they reunite into a bigger one."*<br>
> A physics-driven merge game that runs in your browser. Drop square dumplings into a glass container, touch two of the same level together and they merge into the next one, all the way up to the biggest.

[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![make-with-love-and-passion](https://img.shields.io/badge/make%20with%20%E2%9D%A4%EF%B8%8F+%F0%9F%94%A5-ffcaa1)

Techstack:<br>
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-B73BFE?style=flat&logo=vite&logoColor=FFD62E)
![Matter.js](https://img.shields.io/badge/Matter.js-4B5562?style=flat)
![Canvas 2D](https://img.shields.io/badge/Canvas_2D-E34F26?style=flat&logo=html5&logoColor=white)


| <span style="color:#FF99CC">📢 Think it's fun? Share it with a friend!</span><br> | Going live soon (Vercel) |
|-|-|
| <span style="color:#05C189">📧 Suggestions or bug reports</span><br>| [Open an issue](https://github.com/Vocaloid2048/EndchiMerge/issues) |

## <span style="color:#C3D630"> 🚧 Please note
### This is an unofficial fan project
- Not affiliated with, endorsed by, or licensed by **Hypergryph** or **Gryphline**
- Inspired by the "山團團" mini-game from *Arknights: Endfield*
- All character names and related artwork remain the property of their respective owners
- This project is **completely free, with no purchases and no ads**, and will never be monetised in any form
- If a rights holder objects to anything here, we will take it down immediately

### Data collection
- We do not collect any sensitive personal data
- Progress and settings are stored only in your browser's local storage
- Once leaderboards are live, only the following will be uploaded: an anonymous device UUID, the display name you choose, and your score. **Nothing that identifies you**


## <span style="color:#569CD6">🏞️ Design</span>
|![Main screen design](docs/design-main-screen.jpg)|
|-|
|Main screen design (background art still in progress)|

## <span style="color:#569CD6">🎮 How to play</span>
1. Move the mouse / slide your finger to aim
2. Press (or tap) to drop the dumpling currently on show
3. Two dumplings of the **same level** touching each other → merge into the next level
4. Merges in quick succession build a **Combo**, raising the score multiplier
5. The container overflowing ends the run and banks your score

## <span style="color:#569CD6">🧩 Merge chain (10 levels)</span>
Start with the smallest, 萊萬汀, and work your way up to 梨諾:

| Level | Character | Level | Character |
|:--:|:--|:--:|:--|
| 1 | 萊萬汀 | 6 | 莊方宜 |
| 2 | 潔爾佩塔 | 7 | 弭弗 |
| 3 | 伊馮 | 8 | 卡繆 |
| 4 | 湯湯 | 9 | 訣 |
| 5 | 洛茜 | 10 | 梨諾 |

> The chain length, character names and every per-level physics value live in JSON. Adding a character or retuning the numbers never requires a rebuild.

## <span style="color:#569CD6">⚡ SP and skills</span>
Every successful drop banks **1.0 SP**. The gauge doubles as the unlock gate — and it reads the **current** value, so a skill lights up while the gauge is high enough and locks again the moment you spend.

| Skill | Effect | Cost |
|:--|:--|:--:|
| 捨棄 (Discard) | Pick one dumpling in the container and remove it | 1 |
| 協議：浮動 (Protocol: Float) | Lift **all** dumplings upward for a short while, opening up merge opportunities | 2 |
| 搖晃！ (Shake!) | Shake the container to break up a jammed stack | 3 |
| 命運互換 (Fate Swap) | Pick **two** dumplings, swap their positions and stir the physics around them | 4 |

> The skill table is JSON-defined too. The number of skills is not hard-coded.

## <span style="color:#569CD6">✨ Features</span>
- ✅ **Real physics**: driven by Matter.js — gravity, collision and stacking all follow genuine mechanics, with tunable parameters
- ✅ **Config-driven**: levels, skills, container frame and branding all live in `public/config/`, editable without a rebuild
- ✅ **Hand-drawn vector art**: dumplings are hand-authored SVG, so they scale losslessly and the white outline hugs the character silhouette rather than the image bounds
- ✅ **Landscape 16:9 responsive**: the container has no fixed pixel size; it scales proportionally and fills the space available
- ✅ **Fallback first**: missing art or config degrades gracefully and never leaves a blank screen
- ✅ **Free and open source**: MIT licensed. Play it, fork it, change it

## 💻 Running locally
<details>

```bash
# 1. Clone the repo
git clone https://github.com/Vocaloid2048/EndchiMerge.git

# 2. Enter the directory
cd EndchiMerge

# 3. Install dependencies
npm install

# 4. Start the dev server
npm run dev
```

Other commands:

```bash
npm run build      # typecheck + bundle
npm run preview    # preview the production build
npm run typecheck  # typecheck only
```

Requires Node.js 20 or newer.
</details>

## 📂 Project structure
<details>

```
EndchiMerge
├─docs                          # Documentation
│  ├─physics.md                 # Derivation of the physics numbers and why they are provisional
│  └─design-main-screen.jpg     # Main screen design
├─public                        # Served verbatim, never bundled
│  ├─config                     # Game configuration (externalised, no rebuild needed)
│  │  ├─levels.json             # The 10-level merge chain and per-level physics
│  │  ├─skills.json             # SP settings and the skill table
│  │  ├─container.json          # Decorative 3D frame parameters
│  │  └─branding.json           # Game name, notices, repo link
│  └─assets                     # Art and audio
│     ├─sprites                 # Character SVG (the dumplings)
│     ├─icons                   # Toolbar icons
│     ├─ui                      # Panel decoration
│     └─audio                   # Sound effects
├─src
│  ├─core                       # Foundation with no business logic
│  │  ├─types.ts                # Types for config and game state
│  │  ├─constants.ts            # Global constants
│  │  └─rng.ts                  # Seedable random source (for deterministic tests)
│  ├─styles
│  │  ├─main.css                # Reset and layout host
│  │  ├─tokens.css              # Colour, spacing and radius variables
│  │  └─panels.css              # Shared panel styles
│  ├─main.ts                    # Application entry point
│  └─vite-env.d.ts
├─index.html
├─package.json
├─tsconfig.json / tsconfig.app.json / tsconfig.node.json
└─vite.config.ts
```

> Game logic (`src/game/`, `src/render/`, `src/ui/`) lands as development progresses. The full milestone list lives in `docs/`.
</details>

## <span style="color:#569CD6">🚦 Progress</span>
| Phase | Scope | Status |
|:--|:--|:--:|
| M0 | Scaffold, config system, SVG loading and collision-radius calibration | 🚧 In progress |
| M1–M2 | Layout skeleton, visual system, snake roster and silhouette outline | ⏳ Pending |
| M3–M4 | Container rendering, drop input, merge core and combo | ⏳ Pending |
| M5–M6 | SP and skills, unlock system and codex | ⏳ Pending |
| M7–M9 | Save data and backend sync, leaderboards, analytics and anti-cheat | ⏳ Pending |
| M10 | Deployment, audio, accessibility | ⏳ Pending |

## 🙏 Credits
- Gameplay inspired by the "山團團" mini-game in *Arknights: Endfield*, all rights reserved by **Hypergryph / Gryphline**
- Character designs remain the property of **Hypergryph / Gryphline**; this project exists as a technical demonstration and fan work only
- AI usage: most of the code and documentation in this project is AI-assisted; the character SVG artwork is hand-drawn:
  - Code: Claude, CodeBuddy
  - Text: Claude

### Contributors
<a href="https://github.com/Vocaloid2048/EndchiMerge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Vocaloid2048/EndchiMerge" />
</a>

---

[繁體中文版](README.md)
