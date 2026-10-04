/**
 * 極簡 DOM 建構工具。
 * Minimal DOM construction helpers.
 *
 * `ui/` 底下的模組不引入任何框架（agent-readme §0.2 的依賴方向與體積考量），
 * 這支把重複的 `document.createElement` + `className` + `textContent` 樣板收斂成
 * 兩個函式，避免十幾個模組各寫一份。
 * Modules under `ui/` use no framework, so these two helpers absorb the repetitive
 * create-element/assign-class boilerplate that would otherwise be copy-pasted into
 * every UI module.
 */

/**
 * 建立一個元素。
 * Create one element.
 *
 * @param tag 標籤名，例如 `'canvas'` / Tag name, e.g. `'canvas'`.
 * @param className 選填的 class 字串 / Optional class string.
 * @param text 選填的文字內容 / Optional text content.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 依序附加多個子節點或字串。 */
export function appendChildren(parent: HTMLElement, ...children: readonly (Node | string)[]): void {
  for (const child of children) {
    parent.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/**
 * 在容器內依 `data-hook` 找一個子元素。
 * Find a descendant by its `data-hook` value.
 *
 * 用 data-hook 而非 class：class 會被樣式調整而改名，hook 只為了程式取用而存在，
 * 兩者混用會讓「改個顏色」變成「弄壞功能」。
 * Hooks are separate from classes so that restyling never breaks behaviour.
 */
export function hook<T extends HTMLElement = HTMLElement>(root: ParentNode, name: string): T {
  const found = root.querySelector<T>(`[data-hook="${name}"]`);
  if (found === null) {
    throw new Error(`Expected a [data-hook="${name}"] element but none was found.`);
  }
  return found;
}
