/**
 * 極簡 DOM 建構工具：`ui/` 底下不引入框架，這兩個函式收斂重複的建立元素樣板。
 * Minimal DOM construction helpers used by the framework-free `ui/` modules.
 */

/**
 * 建立一個元素。
 * Creates one element.
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

/**
 * 依序附加多個子節點或字串。
 * Appends several child nodes or strings in order.
 */
export function appendChildren(parent: HTMLElement, ...children: readonly (Node | string)[]): void {
  for (const child of children) {
    parent.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/**
 * 在容器內依 `data-hook` 找一個子元素；找不到就丟錯。
 * Finds a descendant by its `data-hook` value, throwing when none is found.
 */
export function hook<T extends HTMLElement = HTMLElement>(root: ParentNode, name: string): T {
  const found = root.querySelector<T>(`[data-hook="${name}"]`);
  if (found === null) {
    throw new Error(`Expected a [data-hook="${name}"] element but none was found.`);
  }
  return found;
}
