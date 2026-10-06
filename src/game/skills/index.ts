/**
 * 技能註冊表：把 `skills.json` 的 `id` 對到實作 class。
 * The skill registry: maps a `skills.json` `id` onto its implementing class.
 *
 * 註冊表是「config 驅動」與「class 實作」之間唯一的接縫。`skills.json` 決定有哪些技能、
 * 消耗多少、怎麼解鎖、參數為何；這裡決定那條設定要接上哪一段程式。因此：
 * The registry is the single seam between "config-driven" and "class implementations".
 * `skills.json` decides which skills exist, what they cost, how they unlock and with which
 * parameters; this file decides which code those settings attach to. Hence:
 *
 * - **新增技能**：在旁邊加一個 `XxxSkill.ts`，在這裡註冊一行，再在 `skills.json` 加一條。
 * - **`skills.json` 出現未註冊的 id**：該條**被略過**（不是報錯、也不是當成萬用技能）。
 *   及早略過比接上一段錯的效果安全得多，而 `configLoader` 已經保證每一條都有 id。
 * - **Adding a skill**: drop an `XxxSkill.ts` next to this file, register one line here, and add
 *   one entry to `skills.json`.
 * - **An unregistered id in `skills.json`** is **skipped** rather than errored or faked. Skipping
 *   early is far safer than wiring up the wrong effect, and `configLoader` already guarantees
 *   every entry has an id.
 */

import type { SkillDef } from '../../core/types';
import { DiscardSkill } from './DiscardSkill';
import { FateSwapSkill } from './FateSwapSkill';
import { FloatSkill } from './FloatSkill';
import { ShakeSkill } from './ShakeSkill';
import { Skill } from './Skill';

/** 一個技能 class 的建構子形狀。 */
export type SkillClass = new (definition: SkillDef) => Skill;

/** `id` → class。順序不重要：顯示順序由 `configLoader` 排好後帶進來。 */
const SKILL_CLASSES: ReadonlyMap<string, SkillClass> = new Map<string, SkillClass>([
  ['discard', DiscardSkill],
  ['protocol_float', FloatSkill],
  ['shake', ShakeSkill],
  ['fate_swap', FateSwapSkill],
]);

/** 這個 id 有沒有實作。 */
export function hasSkillImplementation(id: string): boolean {
  return SKILL_CLASSES.has(id);
}

/** 依一條定義建立技能；沒有對應實作時回傳 `null`。 */
export function createSkill(definition: SkillDef): Skill | null {
  const SkillImpl = SKILL_CLASSES.get(definition.id);
  if (SkillImpl === undefined) return null;

  return new SkillImpl(definition);
}

/**
 * 依整張技能表建立技能清單，順序沿用傳入的順序（已由 `configLoader` 排好）。
 * Build the skill list from the whole table, preserving the incoming order (already sorted by
 * `configLoader`).
 */
export function createSkills(definitions: readonly SkillDef[]): Skill[] {
  const skills: Skill[] = [];

  for (const definition of definitions) {
    const skill = createSkill(definition);
    if (skill !== null) skills.push(skill);
  }

  return skills;
}

export { Skill } from './Skill';
export { DiscardSkill } from './DiscardSkill';
export { FloatSkill } from './FloatSkill';
export { ShakeSkill } from './ShakeSkill';
export { FateSwapSkill } from './FateSwapSkill';
export type { BoardTarget, FloatRequest, ShakeRequest, SkillBoard } from './board';
