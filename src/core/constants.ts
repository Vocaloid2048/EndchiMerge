/**
 * 全域常數。
 * Global constants.
 *
 * 只放真正全域、且不適合外部化成 JSON 的值。可調參數一律放
 * `public/config/`，不要加進來。
 * Only values that are truly global and unsuitable for externalisation live
 * here. Anything tunable belongs in `public/config/`.
 */

/**
 * 世界座標的虛擬高度。
 * Virtual height of the world.
 *
 * 鎖高度而非鎖寬度：垂直空間決定遊戲難度（堆疊高度、溢出線），鎖高度才能保證
 * 換裝置時難度曲線不變。寬度依容器實際像素寬度浮動。
 * Height is locked rather than width because vertical space determines
 * difficulty. Locking height keeps the difficulty curve stable across devices;
 * the width floats with the container.
 */
export const VIRTUAL_HEIGHT = 1000;

/** 牆壁厚度，虛擬單位。同時用於把遊戲區往內縮，避免貼邊物體被畫出框外。 */
export const WALL_THICKNESS = 16;

/**
 * Sprite 正規化的三個常數（design.md §1.5.1／D16／D28）。
 * The three sprite normalisation constants.
 *
 * 素材端已把每個角色正規化成「512² 畫布、body 外框 304、body 中心 (256, 328)、
 * 其餘完全透明」。因此渲染器**不需要**在 `levels.json` 存任何尺寸或偏移 ——
 * 只要這三個數字就能把任何等級的碰撞圓對上畫面。
 * The assets are normalised to a 512² canvas with a 304 body box centred at
 * (256, 328) and fully transparent padding, so the renderer needs no per-level size
 * or offset — these three numbers are enough to align any collision circle.
 *
 * 留白必須透明（§1.5.1）：§3.2 的輪廓白框是從 alpha 通道推導形狀的，若留白填白，
 * 剪影會變成整張畫布而讓所有量測靜默失效。
 * The padding must stay transparent: the D20 outline frame derives its shape from the
 * alpha channel, so opaque padding would silently turn the silhouette into the whole
 * canvas.
 */
export const SPRITE_SIZE = 512;

/** body 外框邊長，像素。實測為 304 ± 2。 */
export const SPRITE_BODY = 304;

/** body 中心在畫布中的位置，像素。y 偏下是因為裝飾多在身體上方。 */
export const SPRITE_ANCHOR = { x: 256, y: 328 } as const;

/**
 * 「碰撞半徑 → sprite 繪製縮放」的換算率。
 * Conversion factor from collision radius to sprite draw scale.
 *
 * 與 design.md §1.5.1 的公式一致：`scale = (2 * radius) / SPRITE_BODY`。
 * Matches the formula in design.md §1.5.1.
 */
export function spriteScaleForRadius(radius: number): number {
  return (2 * radius) / SPRITE_BODY;
}

/**
 * 技力硬上限（程式常數）。
 * Hard ceiling for SP (a code constant).
 *
 * 這是安全閥，不是玩法參數：`skills.json` 的 `sp.max` 載入時會被鉗制到此值以下，
 * 而且必須是 **1 到 10 之間的正整數**（使用者定案）。存在理由是避免配置檔寫出一個
 * 爆掉 UI 的數字 —— 技力條「一點一條」，上限同時決定段數。
 * This is a safety valve rather than a gameplay parameter: `sp.max` from
 * `skills.json` is clamped to it on load and must be a **positive integer between 1 and
 * 10** (the user's decision), because the SP meter draws one pill per point and the cap
 * therefore also fixes the segment count.
 */
export const SP_MAX_CEILING = 10;

/** 技力上限的下界（正整數，至少 1 點）。 */
export const SP_MIN = 1;

/**
 * 技力上限的預設值（`skills.json → sp.max` 的內建替身）。
 * The default SP cap, mirroring `skills.json → sp.max`.
 */
export const SP_DEFAULT_MAX = 3;

/**
 * 搖晃位移半徑的硬上限（容器寬度的 1/3，使用者定案）。
 * The hard cap on a shake's orbit radius, as a fraction of the container width.
 */
export const SHAKE_RADIUS_FACTOR_MAX = 1 / 3;

/**
 * 浮動結束後的溢位緩衝，毫秒（使用者定案 0.5 秒）。
 * The overflow buffer after a float ends, in ms (the user's decision: 0.5 s).
 *
 * 浮動期間完全不計算溢位；結束後再等這一段緩衝才恢復計算，讓落回來的堆疊有時間安定，
 * 不會因為浮動剛結束就立刻被判越線。
 * Overflow is not evaluated at all while floating, and stays paused for this buffer
 * afterwards so the falling stack has time to settle instead of tripping the instant the
 * float ends.
 */
export const FLOAT_OVERFLOW_BUFFER_MS = 500;

/**
 * 搖晃期間剛體速度的保險上限，世界單位／步。
 * A safety cap on body speed while a shake runs, in world units per step.
 *
 * 使用者給的晃動幅度（2 秒 5 圈、半徑最多 1/3 容器寬）換算成牆壁線速度是每步數十單位 ——
 * 照字面跑會把整箱方團團甩飛、甚至穿透薄牆。這個上限讓最壞情況仍然是「被搖得很厲害」
 * 而不是「炸開」，是**穩定性護欄**而非玩法參數。
 * The user's stated amplitude (5 revolutions in 2 s, radius up to 1/3 the width) works out to
 * tens of world units of wall travel per step — taken literally it flings the box and can tunnel
 * through the thin walls. This cap keeps the worst case at "vigorously shaken" rather than
 * "exploded"; it is a **stability guard**, not a gameplay parameter.
 */
export const SHAKE_MAX_BODY_SPEED = 12;

/**
 * 搖晃時，方團團吃到的加速度相對「容器本身加速度」的耦合比例。
 * How much of the container's own acceleration the dumplings actually receive during a shake.
 *
 * 物理上，站在震動地面上的物體會感受到與地面**相同**的加速度（慣性力），也就是耦合
 * 應該等於 1。但容器寬 789 虛擬單位 × 半徑比例 0.12 × 2 秒 5 圈，峰值加速度換算成
 * 「每步速度增量」約 6.5 單位／步 —— 全量耦合會讓整箱方團團像彈珠一樣亂飛。
 * Physically a body standing on shaking ground feels the **same** acceleration as the ground, so
 * the coupling "should" be 1. Taken literally, a 789-unit-wide container at 0.12 × width with 5
 * cycles in 2 s works out to about 6.5 units/step of peak velocity — full coupling flings the
 * whole box around like marbles.
 *
 * 所以這個值把「物理正確」折衷成「玩起來對」：顆粒仍被確實甩動、卡住的堆疊會鬆開，
 * 但不會失控。它與 `SHAKE_MAX_BODY_SPEED` 是同一類東西 —— **手感護欄**，改它之前先試玩。
 * It trades physical exactness for feel: the pile is genuinely thrown around and jams break up,
 * without going out of control. Like `SHAKE_MAX_BODY_SPEED` it is a **feel guard**; play it
 * before changing it.
 */
export const SHAKE_BODY_ACCEL_COUPLING = 0.3;

/**
 * 技能天花板那片隱形平面的厚度，虛擬單位（協議：浮動與搖晃！共用同一片）。
 * Thickness of the invisible skill-ceiling plane, in virtual units (Protocol: Float and
 * Shake! share the same plate).
 *
 * 平面本身不畫出來，厚度只影響兩件事：夠厚才不會被高速顆粒穿透，但太厚會在技能開始的
 * 那一刻「包住」正在下墜的顆粒。40 約等於兩片半牆厚 —— 遠大於任何一顆每步的位移，
 * 又遠小於投放點到天花板的距離。
 * The plane is never drawn; its thickness only matters twice over: thick enough that a fast body
 * cannot tunnel through, thin enough not to swallow a body that is mid-drop when the skill
 * starts. 40 is about two and a half wall thicknesses — far more than any body's per-step
 * travel, far less than the gap between the drop point and the ceiling.
 *
 * **40 → 100（使用者回報後加厚）**：浮動時整堆被追趕速度地板從下面頂住平面，最輕的那顆
 * 會像西瓜籽一樣被擠出薄平面（畫面上就是「浮到容器口外懸着」）。加厚之後，被擠入的顆粒
 * 離最近的出口（底面）更遠，求解器的最小平移修正一律把它推回下方；配合每步的
 * `containAtCeiling()`（見 `session.ts`），穿透在 8 單位內就會被壓回，根本到不了上半。
 * **40 → 100 (thickened after a user report)**: during a float the whole pile is rammed against
 * the plane from below by the catch-up velocity floor, and the lightest body gets squeezed
 * through a thin plane like a watermelon seed (on screen: "hovering outside the container
 * mouth"). Thicker means a body squeezed in is much closer to the near (bottom) face, so the
 * solver's minimum-translation correction always pushes it back down; combined with the per-step
 * `containAtCeiling()` (see `session.ts`), any penetration is pressed back within 8 units and
 * never reaches the upper half.
 */
export const CEILING_THICKNESS = 100;

/** Matter.js 的重力縮放（與 `core/physics.ts` 的引擎設定必須一致）。 */
export const ENGINE_GRAVITY_SCALE = 0.001;

/** Matter.js 求解器迭代次數。提高位置迭代可減少堆疊穿透，代價是 CPU。 */
export const ENGINE_POSITION_ITERATIONS = 8;

/** Matter.js 速度迭代次數。 */
export const ENGINE_VELOCITY_ITERATIONS = 6;

/** 是否啟用休眠。靜止物體會停止計算，對大量堆疊的效能影響顯著。 */
export const ENGINE_ENABLE_SLEEPING = true;

/** 合成時的彈跳動畫時長，毫秒。 */
export const POP_ANIMATION_MS = 180;

/** 彈跳動畫的峰值縮放倍率。 */
export const POP_PEAK_SCALE = 1.3;

/**
 * 輪廓邊緣間隙的合成容差，虛擬單位（使用者定案：改用輪廓實際接觸判定）。
 * The merge tolerance for the edge gap between two outlines, in virtual units (the user's
 * decision: judge by the outlines actually touching).
 *
 * 兩顆**同級**方團團的輪廓邊緣間隙 ≤ 這個值（或已經重疊）時判定可合成。
 * Two **same-level** dumplings merge once the edge gap between their outlines is at most this
 * value, or once the outlines already overlap.
 *
 * **為什麼改用輪廓而不是圓心距離**：圓心距離法對**不同尺寸**的配對會系統性失準 —— 一顆
 * 小顆粒夾在兩顆大顆粒之間時，視覺上已經相依，但圓心距離被「自己的半徑 ＋ 鄰居的半徑」
 * 綁死，遠超任何合理的圓心容差。使用者的截圖正是這個情境。邊緣間隙沒有這個偏誤，它直接
 * 量「兩張圖差多遠」。
 * **Why outlines instead of centre distance**: a centre-radius rule is systematically wrong
 * for **mixed-size** pairs — a small dumpling wedged between two larger ones is visually
 * adjacent, yet its centre distance is pinned by "my radius + their radius" and lands far
 * beyond any sensible centre tolerance. The user's screenshot is exactly this case. The edge
 * gap has no such bias: it measures directly how far apart the artwork is.
 *
 * **為什麼是固定值而非比例**：輪廓間隙已經是絕對距離，不像圓心距離那樣隨半徑和放大，
 * 所以固定值就夠 —— 而且它對應的是「畫面上的視覺縫隙」，玩家的感受本來就與尺寸無關。
 * **Why a fixed value, not a ratio**: an outline gap is already an absolute distance rather
 * than something that scales with the radii' sum, so a constant suffices — and it corresponds
 * to the on-screen visual seam, which the player perceives independently of size.
 *
 * 值取 4：約為最小等級（半徑 15）直徑的 13%，對應「幾乎貼住」的視覺感受。
 * A value of 4 is about 13% of the smallest level's diameter (radius 15) — the "just about
 * touching" band.
 */
export const MERGE_OUTLINE_GAP = 4;

/**
 * 合成後對鄰居的推力係數（使用者定案：按重疊深度推開）。
 * The push factor applied to neighbours after a merge (the user's decision: push apart by
 * overlap depth).
 *
 * 合成出來的那顆比兩顆原料都**大**，而它生成在兩者的質心 —— 多出來的面積沒有地方去，
 * 就會陷進旁邊的方團團裡。使用者的截圖正是這個：新生成的小顆粒整個埋在大顆粒的左上角。
 * 補救是「誰被壓到就推誰」：對每個與新顆粒重疊的鄰居，沿連心線推開，位移量 ＝
 * `重疊深度 × MERGE_PUSH_FACTOR`。
 * The merged dumpling is **larger** than either input yet spawns at their midpoint, so the
 * extra area has nowhere to go and sinks into the neighbours — exactly the user's screenshot,
 * where a freshly merged dumpling sits buried in a large one's corner. The remedy is "push
 * whoever got crushed": every neighbour overlapping the new body is displaced along the centre
 * line by `overlap depth × MERGE_PUSH_FACTOR`.
 *
 * **為什麼大於 1**：深度本身只夠「剛好分開」，但新顆粒生成後還在彈跳動畫中、且下一幀物理
 * 會繼續把它往下壓，1.0 會立刻又重疊。稍微過推（1.15）讓分開維持得住。
 * **Why above 1**: the raw depth only just separates them, but the new body is still inside its
 * pop animation and physics pushes it back down on the next frame, so 1.0 re-overlaps
 * immediately. A slight overshoot (1.15) makes the separation stick.
 */
export const MERGE_PUSH_FACTOR = 1.15;

/**
 * 合成推力附帶的速度增量比例（每單位深度）。
 * The velocity kick per unit of overlap depth, applied alongside the merge push.
 *
 * 只有位置位移的話，鄰居會被「瞬移」到旁邊、看起來很硬。附帶一點速度讓它自然地滑開，
 * 分開的過程才像被擠出來而不是被傳送。
 * A position shift alone teleports the neighbour aside, which reads as rigid. A small velocity
 * kick lets it slide away, so the separation looks like being squeezed out rather than moved.
 */
export const MERGE_PUSH_SPEED = 0.05;

/**
 * 合成推力的深度上限，世界單位。
 * The cap on overlap depth used for a merge push, in world units.
 *
 * 沒有上限的話，一顆大顆粒整個包住小顆粒時會算出極大的深度（區間重疊可以到對方整條直徑），
 * 把鄰居彈到容器另一端。上限讓最壞情況也只是「明顯推開」，不會變成彈射。
 * Without a cap, a small dumpling wholly inside a large one reports an enormous depth (the
 * interval overlap can reach the other shape's whole diameter) and launches the neighbour
 * across the container. The cap keeps the worst case at "clearly pushed aside" rather than
 * "catapulted".
 */
export const MERGE_PUSH_MAX_DEPTH = 12;

/**
 * 合成後「向下投影找支撐」的最大吸附距離，世界單位。
 * The maximum snap distance for the post-merge downward projection, in world units.
 *
 * 合成的位置取兩顆原料的質心中點，這個點有時會落在半空中（兩顆原本堆在高處、或被推開後才
 * 合成）。此時新顆粒若原地出現，就會在空中定格一下才落下 —— 肉眼可見的違和。
 * A merge spawns at the inputs' midpoint, and that point sometimes sits in mid-air (inputs stacked
 * high, or pushed apart before merging). A body appearing there would hang for a moment before
 * falling — a visible stall.
 *
 * 補救是「往下找最近的支撐，太遠就直接落體」。這個常數就是「太遠」的門檻：只吸附
 * 這個距離以內的支撐。設太大會讓合成結果「瞬間跳到」很遠的地面（更怪異），設太小則大多數
 * 凌空情況都吸附不到、等於沒做事。
 * The remedy is "find the nearest support below, and free-fall if it is too far". This constant is
 * the "too far" threshold. Too large makes the result teleport to a distant floor (worse), too
 * small fails to catch the very cases it exists for.
 *
 * 值取 80：約為最大常見等級的直徑量級 —— 夠涵蓋「一顆的高度忽然空掉」，又遠小於容器高度
 * （見 `levels.json`），不會把高處的合成結果一把吸到地面。
 * A value of 80 is on the order of a large level's diameter — enough to cover "one body's height
 * suddenly removed", while far below the container height, so a high merge is never yanked to the
 * floor.
 */
export const MERGE_SETTLE_MAX_DROP = 80;

/** 本地儲存鍵的前綴，避免與同網域其他專案衝突。 */
export const STORAGE_PREFIX = 'endchimerge';

/** 本地儲存鍵。 */
export const STORAGE_KEYS = {
  profile: `${STORAGE_PREFIX}:profile`,
  unlocks: `${STORAGE_PREFIX}:unlocks`,
  highScore: `${STORAGE_PREFIX}:high-score`,
  deviceId: `${STORAGE_PREFIX}:device-id`,
  preferences: `${STORAGE_PREFIX}:preferences`,
} as const;

/** 版面斷點（像素）。低於 tablet 視為手機，低於 desktop 視為平板。 */
export const BREAKPOINT_TABLET = 768;

/** 桌面斷點。 */
export const BREAKPOINT_DESKTOP = 1024;
