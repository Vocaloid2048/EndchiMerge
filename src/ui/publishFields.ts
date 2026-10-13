/**
 * 發布設定欄位：顯示名稱 ＋ 同意分享。改完即套用，這裡**不含任何儲存邏輯**。
 * The publish-settings fields: display name + sharing consent; edits apply on their own and no storage logic lives here.
 */

import type { LeaderboardSource } from '../game/leaderboard';
import { NAME_MAX_UNITS, nameUnits, validateDisplayName, type NameError } from '../game/playerName';
import { i18n, i18nPlaceholder, i18nText, t, type MessageKey } from '../i18n';
import { appendChildren, el } from './dom';

/**
 * 一次成功套用：來自哪個欄位、套用之後的分享狀態。
 * One successful apply: which field, and the sharing state afterwards.
 */
export interface PublishChange {
  field: 'name' | 'sharing';
  sharing: boolean;
}

export interface PublishFieldsOptions {
  source: LeaderboardSource;
  /**
   * 每次**成功套用**之後呼叫（改完名字、或勾選／撤銷同意）；驗證失敗不會呼叫。
   * 發布詢問用它把「把同意打開」當成回答（見 `ui/publishPrompt.ts`）。
   * Called after every **successful** apply (a rename or a consent toggle); a failed validation
   * does not call it. The publish prompt treats "consent switched on" as the answer (see
   * `ui/publishPrompt.ts`).
   */
  onApply?: (change: PublishChange) => void;
}

export interface PublishFields {
  readonly element: HTMLElement;
  /**
   * 把兩個控制項同步回來源。**只在宿主開啟時、或來源被別處改動時呼叫**：由來源變更引發的重繪
   * 若也同步，會把玩家剛勾好的「同意」蓋回未勾選。
   * Sync both controls back from the source. **Only call this when the host opens, or when the
   * source changed elsewhere**: syncing on a source-driven re-render would stamp the player's
   * freshly ticked consent back to unchecked.
   */
  sync(): void;
  /**
   * 把游標放進名稱欄。
   * Puts the caret in the name field.
   */
  focus(): void;
  /**
   * 取消語系訂閱；宿主 teardown 用。
   * Unsubscribes the locale listener; for host teardown.
   */
  dispose(): void;
}

/**
 * 驗證失敗的原因 → 訊息鍵。
 * Validation-failure reason → message key.
 */
const NAME_ERROR_KEYS: Readonly<Record<NameError, MessageKey>> = {
  empty: 'nameError.empty',
  charset: 'nameError.charset',
  tooLong: 'nameError.tooLong',
};

/**
 * 實例序號，用來組出唯一的 `id`：同一頁可能同時存在兩個實例（詢問彈窗與設定 popup），
 * 而 `<label for>` 需要唯一 id。
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
   * The text lives in a **separate span**: the label contains the checkbox and `applyTo()` sets
   * `textContent`, which would wipe the checkbox out.
   */
  const shareText = el('span', 'publish-fields__share-text');
  i18nText(shareText, 'publish.consent');

  const shareLabel = el('label', 'publish-fields__share');
  appendChildren(shareLabel, shareInput, shareText);

  const error = el('p', 'publish-fields__error');
  error.hidden = true;

  const element = el('div', 'publish-fields');
  appendChildren(element, nameLabel, nameInput, units, shareLabel, error);

  /**
   * 目前顯示中的錯誤原因；換語系時用它把訊息重寫一遍。
   * The error reason currently shown; used to rewrite the message on a locale change.
   */
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
    /* Do not clobber what the player is typing while the field still has focus. */
    if (document.activeElement !== nameInput) nameInput.value = source.displayName;
    shareInput.checked = source.sharing;
    refreshUnits();
  }

  function focus(): void {
    nameInput.focus();
  }

  /**
   * 套用名稱欄。回傳是否寫入了來源。
   * Applies the name field; returns whether the source was written.
   */
  function applyName(): boolean {
    const result = validateDisplayName(nameInput.value);

    if (!result.ok) {
      /*
       * 只想看榜、不急著上榜的人可以留空；但一旦勾了同意，名字就是必要的。
       * Blank is fine for someone who only wants to look — but once consent is on, a name is required.
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
     * Skip the write when nothing changed: every write bumps the `revision`, triggering another upload.
     */
    if (value !== source.displayName) {
      source.setDisplayName(value);
      onApply?.({ field: 'name', sharing: source.sharing });
    }

    nameInput.value = value;
    clearError();

    return true;
  }

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
     * 要上榜就得有名字：名稱不合法時把勾選**退回**、說明原因、游標放回名稱欄。
     * 順序不能顛倒：`setSharing(true)` 會**順手把本機紀錄推上榜**，而那筆的名字取自來源，
     * 所以名字必須已經在裡面了；同意本身就是上載的觸發點，不需要額外的「交出這一局」呼叫。
     * Publishing needs a name: on an invalid name the tick is **rolled back**, the reason shown
     * and the caret returned to the name field. The order matters: `setSharing(true)` **uploads
     * the local record** as a side effect, and that record's name comes from the source, so the
     * name must be in there first. Consent is itself the upload trigger — no separate hand-over call.
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
   * For a text field `change` means "done editing": it fires on blur and on Enter. Not applied on
   * `input`, which would write to the source on every keystroke — and each write is an upload.
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
