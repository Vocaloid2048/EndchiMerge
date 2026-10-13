/**
 * 技能註冊表：把 `skills.json` 的 `id` 對到實作 class；未註冊的 id 一律略過（不報錯）。
 * The skill registry: maps a `skills.json` `id` onto its implementing class; unregistered ids are skipped, never errored.
 */

import type { SkillDef } from '../../core/types';
import { DiscardSkill } from './DiscardSkill';
import { FateSwapSkill } from './FateSwapSkill';
import { FloatSkill } from './FloatSkill';
import { ShakeSkill } from './ShakeSkill';
import { Skill } from './Skill';

/**
 * 一個技能 class 的建構子形狀。
 * The constructor shape of a skill class.
 */
export type SkillClass = new (definition: SkillDef) => Skill;

/**
 * `id` → class。順序不重要：顯示順序由 `configLoader` 排好後帶進來。
 * `id` → class. Order is irrelevant: the display order arrives pre-sorted from `configLoader`.
 */
const SKILL_CLASSES: ReadonlyMap<string, SkillClass> = new Map<string, SkillClass>([
  ['discard', DiscardSkill],
  ['protocol_float', FloatSkill],
  ['shake', ShakeSkill],
  ['fate_swap', FateSwapSkill],
]);

/**
 * 這個 id 有沒有實作。
 * Whether the id has an implementation.
 */
export function hasSkillImplementation(id: string): boolean {
  return SKILL_CLASSES.has(id);
}

/**
 * 依一條定義建立技能；沒有對應實作時回傳 `null`。
 * Builds a skill from one definition; `null` when no implementation exists.
 */
export function createSkill(definition: SkillDef): Skill | null {
  const SkillImpl = SKILL_CLASSES.get(definition.id);
  if (SkillImpl === undefined) return null;

  return new SkillImpl(definition);
}

/**
 * 依整張技能表建立技能清單，順序沿用傳入的順序（已由 `configLoader` 排好）。
 * Builds the skill list from the whole table, preserving the incoming order (pre-sorted by `configLoader`).
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
