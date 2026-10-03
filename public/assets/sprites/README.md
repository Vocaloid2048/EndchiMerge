# Sprites

角色素材（方團團）。檔名必須與 `public/config/levels.json` 的 `sprite` 欄位完全一致。

## Expected files

| 等級 | 檔名 |
| --- | --- |
| 1 | `萊萬汀.svg` |
| 2 | `潔爾佩塔.svg` |
| 3 | `伊馮.svg` |
| 4 | `湯湯.svg` |
| 5 | `洛茜.svg` |
| 6 | `莊方宜.svg` |
| 7 | `弭弗.svg` |
| 8 | `卡繆.svg` |
| 9 | `訣.svg` |
| 10 | `梨諾.svg` |

## Format

- SVG, hand-drawn vector, **opaque solid fill with no cut-outs**. This matters: the
  outline white border is derived from the alpha silhouette, so any fully
  transparent hole inside the artwork would punch a hole in the border.
- `viewBox` is **not** expected to be uniform across files. Each sprite is scaled
  to fit its cell without distortion; the cell absorbs the remaining whitespace.
- `stroke-width` is part of the artwork and is preserved.

## Missing files

A missing or unloadable sprite degrades to a generated placeholder circle at the
correct collision radius. The game never crashes on a missing asset — it just
looks wrong. Check the browser console for a warning.

## Rights

Character names and artwork belong to their respective rights holders. See
`LICENSE-ASSETS.md` and `NOTICE.md` at the repository root. Do not add assets you
do not have the right to distribute.
