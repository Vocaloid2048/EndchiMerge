/**
 * 發布設定欄位：顯示名稱 ＋ 同意分享。
 * The publish-settings fields: display name + sharing consent.
 *
 * 這一組欄位本來嵌在排行榜彈窗的頂部（「發布列」）。使用者定案把它**單獨拿出來**，因為它
 * 是**玩家設定**而不是榜單的一部分，只有兩個地方會用到它：
 * 1. 首次按下排行榜時的**發布詢問**（`ui/publishPrompt.ts`）；
 * 2. **設定 popup**（要改名稱或分享意願時）。
 * 兩處共用同一支元件，驗證、內嵌儲存鍵與排版才不會各養一份。
 * These fields used to sit at the top of the leaderboard popup. The user's decision was to
 * **take them out on their own**, because they are **player settings** rather than part of the
 * board, and only two places need them: the **publish prompt** on the first leaderboard open
 * (`ui/publishPrompt.ts`), and the **settings popup**. Sharing one component keeps validation,
 * the inset save key and the layout from being written twice.
 *
 * 這一支**不含任何儲存邏輯**：寫入與否、寫去哪裡都由 `LeaderboardSource` 決定，這裡只負責
 * 「驗證 → 交給來源 → 顯示錯誤」。
 * **No storage logic lives here**: where and whether things persist is the `LeaderboardSource`'s
 * business; this only validates, hands values to the source and shows errors.
 *
 * 文字全部走 `src/i18n`：靜態的用 `data-i18n` 標記（換語系由 `applyTo()` 一次改掉），帶數字
 * 的（單位計數、錯誤訊息）自己重畫並訂閱語系變更。
 * All copy goes through `src/i18n`: static strings are tagged with `data-i18n` (rewritten in one
 * `applyTo()` pass), and the ones carrying numbers (the unit counter, error messages) redraw
 * themselves and subscribe to locale changes.
 *
 * 尺寸是**設計稿像素**，與其他面板同一套座標語言。
 * Sizes are **design pixels**, the same coordinate language as every other panel.
 */

import type { LeaderboardSource } from '../game/leaderboard';
import { NAME_MAX_UNITS, nameUnits, validateDisplayName, type NameError } from '../game/playerName';
import { i18n, i18nPlaceholder, i18nText, t, type MessageKey } from '../i18n';
import { appendChildren, el } from './dom';

export interface PublishFieldsOptions {
  /** 設定來源。 */
  source: LeaderboardSource;
  /**
   * 儲存成功**且同意分享**之後呼叫。呼叫端用它在這一刻把「正在進行的一局」交出去 —— 玩家
   * 按下儲存就預期看到自己的紀錄，不是等這一局結束。
   * Called after a successful save **with sharing on**. The caller uses it to hand over the
   * **run in progress**: the player expects to see his record as soon as save is pressed.
   */
  onPublish?: () => void;
  /**
   * 內嵌儲存鍵按下且驗證通過之後呼叫。宿主用它收尾（關窗、開榜），不必自己去找那顆按鈕。
   * Called when the inset save key is pressed and validation passes. The host uses it to finish
   * up (close, open the board) without having to reach for the button itself.
   */
  onCommitted?: () => void;
}

export interface PublishFields {
  /** 可直接 append 的根節點。 */
  readonly element: HTMLElement;
  /**
   * 把兩個輸入框同步回來源。**只在宿主開啟時呼叫**：由來源變更引發的重繪若也同步，會把
   * 玩家剛勾好的「同意」蓋回未勾選（曾因此讓分享永遠開不起來）。
   * Sync both inputs back from the source. **Only call this when the host opens**: syncing on a
   * re-render caused by a source change would stamp the player's freshly ticked consent back to
   * unchecked — the bug that once left sharing permanently off.
   */
  sync(): void;
  /** 驗證並儲存；成功回傳 `true`，失敗會顯示錯誤訊息並回傳 `false`。 */
  commit(): boolean;
  /** 把游標放進名稱欄。 */
  focus(): void;
  /** 取消語系訂閱；宿主 teardown 用。 */
  dispose(): void;
}

/** 驗證失敗的原因 → 訊息鍵。 */
const NAME_ERROR_KEYS: Readonly<Record<NameError, MessageKey>> = {
  empty: 'nameError.empty',
  charset: 'nameError.charset',
  tooLong: 'nameError.tooLong',
};

/**
 * 實例序號，用來組出唯一的 `id`。
 * 同一頁可能同時存在兩個實例（詢問彈窗與設定 popup），而 `<label for>` 需要唯一 id。
 * An instance counter for unique ids: two instances can coexist on the page (the prompt and the
 * settings popup), and `<label for>` needs a unique id.
 */
let instanceCount = 0;

export function createPublishFields(options: PublishFieldsOptions): PublishFields {
  const { source, onPublish, onCommitted } = options;

  instanceCount += 1;
  const nameId = `publish-fields-name-${String(instanceCount)}`;

  const nameLabel = el('label', 'publish-fields__label');
  nameLabel.htmlFor = nameId;
  i18nText(nameLabel, 'publish.name');

  const nameInput = el('input', 'publish-fields__name');
  nameInput.id = nameId;
  nameInput.type = 'text';
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  i18nPlaceholder(nameInput, 'publish.namePlaceholder');

  const saveButton = el('button', 'publish-fields__save');
  saveButton.type = 'button';
  i18nText(saveButton, 'common.save');

  /*
   * 儲存鍵放在名稱欄**裡面**、貼齊右緣（使用者定案）：對輸入框而言它是浮在右側的一顆小鍵，
   * 寬度隨文字（`width: auto`），所以欄位的右內距要留得下它 —— 否則打到後面的字會滑到
   * 按鈕底下。
   * The save key sits **inside** the name field pinned to the right edge (the user's decision):
   * it floats over the input, sized to its own text (`width: auto`), so the field keeps a right
   * inset large enough for it — otherwise the tail of a long name slides under the button.
   */
  const nameBox = el('div', 'publish-fields__box');
  appendChildren(nameBox, nameInput, saveButton);

  const units = el('p', 'publish-fields__units');

  const shareInput = el('input', 'publish-fields__share-input');
  shareInput.type = 'checkbox';

  /*
   * 文字放在**另一個 span**裡，而不是直接寫在 `<label>` 上：label 內含 checkbox，而 i18n 的
   * `applyTo()` 是設 `textContent` —— 直接標記 label 會把 checkbox 一起抹掉。
   * The text lives in a **separate span** rather than on the `<label>` itself: the label contains
   * the checkbox and `applyTo()` sets `textContent`, which would wipe the checkbox out.
   */
  const shareText = el('span', 'publish-fields__share-text');
  i18nText(shareText, 'publish.consent');

  const shareLabel = el('label', 'publish-fields__share');
  appendChildren(shareLabel, shareInput, shareText);

  const error = el('p', 'publish-fields__error');
  error.hidden = true;

  const element = el('div', 'publish-fields');
  appendChildren(element, nameLabel, nameBox, units, shareLabel, error);

  /** 目前顯示中的錯誤原因；換語系時用它把訊息重寫一遍。 */
  let lastError: NameError | null = null;

  function errorTextFor(reason: NameError): string {
    return t(NAME_ERROR_KEYS[reason], { max: NAME_MAX_UNITS });
  }

  function refreshUnits(): void {
    units.textContent = t('publish.units', {
      used: nameUnits(nameInput.value),
      max: NAME_MAX_UNITS,
    });
  }

  function sync(): void {
    /* 還沒離開名稱欄就不要蓋掉玩家正在打的字。 */
    if (document.activeElement !== nameInput) nameInput.value = source.displayName;
    shareInput.checked = source.sharing;
    refreshUnits();
  }

  function focus(): void {
    nameInput.focus();
  }

  function commit(): boolean {
    const result = validateDisplayName(nameInput.value);

    /*
     * 先把兩個輸入框的值抓成區域變數**再**動來源。`setDisplayName()` 會同步觸發重繪，
     * 若之後才讀 `shareInput.checked`，讀到的可能是已經被重繪蓋掉的值。
     * Capture both inputs into locals **before** touching the source. `setDisplayName()`
     * re-renders synchronously, so reading `shareInput.checked` afterwards could pick up a
     * clobbered value.
     */
    const wantSharing = shareInput.checked;

    if (!result.ok) {
      /* 只想瀏覽、不想分享的人可以留空；但一旦要上榜，名稱就是必要的。 */
      const browseOnly = result.reason === 'empty' && !wantSharing;

      if (!browseOnly) {
        lastError = result.reason;
        error.textContent = errorTextFor(result.reason);
        error.hidden = false;
        focus();
        return false;
      }

      source.setDisplayName('');
      source.setSharing(false);
      lastError = null;
      error.hidden = true;
      return true;
    }

    source.setDisplayName(result.value);
    source.setSharing(wantSharing);
    nameInput.value = result.value;
    lastError = null;
    error.hidden = true;
    refreshUnits();

    /*
     * 同意分享之後，把正在進行的一局也交出去。名稱已經先寫進來源，那一局才會掛上新名字
     * （資料層會認領先前無名的紀錄）。
     * After consenting, hand over the run in progress. The name is written first so that run
     * carries it (the data layer claims the previously nameless records).
     */
    if (wantSharing) onPublish?.();

    return true;
  }

  const unsubscribeLocale = i18n.subscribe((): void => {
    refreshUnits();
    if (lastError !== null) error.textContent = errorTextFor(lastError);
  });

  nameInput.addEventListener('input', (): void => {
    refreshUnits();
    lastError = null;
    error.hidden = true;
  });

  shareInput.addEventListener('change', (): void => {
    lastError = null;
    error.hidden = true;
  });

  saveButton.addEventListener('click', (): void => {
    if (commit()) onCommitted?.();
  });

  refreshUnits();

  return {
    element,
    sync,
    commit,
    focus,
    dispose: (): void => {
      unsubscribeLocale();
    },
  };
}
