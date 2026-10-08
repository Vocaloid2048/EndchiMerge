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
 * **沒有儲存鍵了 —— 改完就套用**（使用者定案）：
 * - **名稱欄**在離開欄位時（失焦、或按 Enter）驗證並寫入來源；不合法就只顯示原因，不寫入。
 * - **同意勾選框**一勾／一撤就立刻套用 —— `setSharing(true)` 本身就會把本機紀錄推上榜，所以
 *   同意之後不必再按任何鍵。
 * 兩者都是「即時、可逆」的設定（名字只是那一筆的欄位、分享只是一個開關），按下一個確認鍵
 * 換不到任何保障，只是多一步。儲存鍵從前存在的理由 —— 避免重繪把剛勾好的同意蓋回去 ——
 * 已經由「先把值抓成區域變數，再動來源」解決掉了。
 * **There is no save key any more — an edit applies on its own** (the user's decision): the
 * **name field** validates and writes on the way out (blur, or Enter), and the **consent box**
 * applies the moment it is ticked or unticked — `setSharing(true)` already pushes the local record
 * itself, so consent needs no second press. Both are instant, reversible settings (a name is one
 * field of one row; sharing is one switch), so a confirm key buys nothing and costs a step. The
 * reason the key existed — a re-render stamping a freshly ticked consent back to unchecked — is
 * handled by capturing values into locals before touching the source.
 *
 * 文字全部走 `src/i18n`：靜態的用 `data-i18n` 標記（換語系由 `applyTo()` 一次改掉），帶數字
 * 的（字元計數、錯誤訊息）自己重畫並訂閱語系變更。
 * All copy goes through `src/i18n`: static strings are tagged with `data-i18n` (rewritten in one
 * `applyTo()` pass), and the ones carrying numbers (the character counter, error messages) redraw
 * themselves and subscribe to locale changes.
 *
 * 尺寸是**設計稿像素**，與其他面板同一套座標語言。
 * Sizes are **design pixels**, the same coordinate language as every other panel.
 */

import type { LeaderboardSource } from '../game/leaderboard';
import { NAME_MAX_UNITS, nameUnits, validateDisplayName, type NameError } from '../game/playerName';
import { i18n, i18nPlaceholder, i18nText, t, type MessageKey } from '../i18n';
import { appendChildren, el } from './dom';

/** 一次成功套用：來自哪個欄位、套用之後的分享狀態。 */
export interface PublishChange {
  /** 這次套用來自哪一個欄位。 */
  field: 'name' | 'sharing';
  /** 套用之後的分享狀態。 */
  sharing: boolean;
}

export interface PublishFieldsOptions {
  /** 設定來源。 */
  source: LeaderboardSource;
  /**
   * 每次**成功套用**之後呼叫（改完名字、或勾選／撤銷同意）。驗證失敗不會呼叫。
   * Called after every successful apply (a rename, or a consent toggle). A failed validation does
   * not call it.
   *
   * 首次的發布詢問用它把「把同意打開」當成回答（見 `ui/publishPrompt.ts`）—— 那個彈窗需要
   * 知道玩家答了沒有；設定 popup 不需要它，那裡改了就是改了。
   * The one-off publish prompt treats "consent switched on" as the answer (see
   * `ui/publishPrompt.ts`), because that popup has to know whether the player replied. Settings
   * does not need it: there, an edit *is* the answer.
   */
  onApply?: (change: PublishChange) => void;
}

export interface PublishFields {
  /** 可直接 append 的根節點。 */
  readonly element: HTMLElement;
  /**
   * 把兩個控制項同步回來源。**只在宿主開啟時、或來源被別處改動時呼叫**：由來源變更引發的重繪
   * 若也同步，會把玩家剛勾好的「同意」蓋回未勾選（曾因此讓分享永遠開不起來）。
   * Sync both controls back from the source. **Only call this when the host opens, or when the
   * source changed elsewhere**: syncing on a re-render caused by a source change would stamp the
   * player's freshly ticked consent back to unchecked — the bug that once left sharing
   * permanently off.
   */
  sync(): void;
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
  const { source, onApply } = options;

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
  appendChildren(element, nameLabel, nameInput, units, shareLabel, error);

  /** 目前顯示中的錯誤原因；換語系時用它把訊息重寫一遍。 */
  let lastError: NameError | null = null;

  function errorTextFor(reason: NameError): string {
    return t(NAME_ERROR_KEYS[reason], { max: NAME_MAX_UNITS });
  }

  function showError(reason: NameError): void {
    lastError = reason;
    error.textContent = errorTextFor(reason);
    error.hidden = false;
  }

  function clearError(): void {
    lastError = null;
    error.hidden = true;
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

  /**
   * 套用名稱欄。回傳是否寫入了來源。
   * Apply the name field. Returns whether the source was written.
   */
  function applyName(): boolean {
    const result = validateDisplayName(nameInput.value);

    if (!result.ok) {
      /*
       * 只想看榜、不急著上榜的人可以留空；但一旦勾了同意，名字就是必要的。
       * Leaving it blank is fine for someone who only wants to look — but once consent is on, a
       * name is required.
       */
      const browseOnly = result.reason === 'empty' && !shareInput.checked;

      if (!browseOnly) {
        showError(result.reason);
        return false;
      }
    }

    const value = result.ok ? result.value : '';

    /*
     * 值沒變就不再寫一次：每一次寫入都會推高 `revision`，因而多觸發一次上載。
     * Skip the write when nothing changed: every write bumps the `revision`, which triggers one
     * more upload.
     */
    if (value !== source.displayName) {
      source.setDisplayName(value);
      onApply?.({ field: 'name', sharing: source.sharing });
    }

    nameInput.value = value;
    clearError();

    return true;
  }

  /** 套用同意勾選框。 */
  function applySharing(): void {
    /*
     * 先把勾選狀態抓成區域變數**再**動來源：`setSharing()` 會同步觸發重繪，之後才讀
     * `shareInput.checked` 可能讀到已經被重繪蓋掉的值。
     * Capture the tick into a local **before** touching the source: `setSharing()` re-renders
     * synchronously, so reading `shareInput.checked` afterwards could pick up a clobbered value.
     */
    const want = shareInput.checked;

    if (!want) {
      source.setSharing(false);
      onApply?.({ field: 'sharing', sharing: false });
      return;
    }

    /*
     * 要上榜就得有名字：名稱不合法時把勾選**退回**、說明原因、游標放回名稱欄，而不是讓一個
     * 沒有名字的人上了榜。
     * Publishing needs a name: if it is not valid the tick is **rolled back**, the reason is shown
     * and the caret goes back to the name field — rather than putting a nameless player on the
     * board.
     *
     * 順序不能顛倒：`setSharing(true)` 會**順手把本機紀錄推上榜**，而那筆的名字取自來源，
     * 所以名字必須已經在裡面了。這裡也**不需要**任何「把這一局交出去」的呼叫 —— 同意本身就是
     * 上載的觸發點。
     * The order matters: `setSharing(true)` **uploads the local record** as a side effect, and that
     * record's name comes from the source, so the name has to be in there first. No "hand over the
     * run" call is needed either: consent is itself the trigger.
     */
    if (!applyName()) {
      shareInput.checked = false;
      focus();
      return;
    }

    source.setSharing(true);
    onApply?.({ field: 'sharing', sharing: true });
  }

  const unsubscribeLocale = i18n.subscribe((): void => {
    refreshUnits();
    if (lastError !== null) error.textContent = errorTextFor(lastError);
  });

  nameInput.addEventListener('input', (): void => {
    refreshUnits();
    clearError();
  });

  /*
   * `change` 對文字欄而言就是「改完了」：失焦或按 Enter 都會觸發。**不在 `input` 上套用**，
   * 否則玩家打到一半就會不斷寫入來源（每一筆都是一次上載）。
   * For a text field `change` literally means "done editing": it fires on blur and on Enter. It is
   * deliberately not applied on `input`, which would write to the source on every keystroke — and
   * each write is an upload.
   */
  nameInput.addEventListener('change', (): void => {
    applyName();
  });

  shareInput.addEventListener('change', (): void => {
    applySharing();
  });

  refreshUnits();

  return {
    element,
    sync,
    focus,
    dispose: (): void => {
      unsubscribeLocale();
    },
  };
}
