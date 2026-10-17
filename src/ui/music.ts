/**
 * 背景音樂：一首循環播放的 mp3，由工具列右邊的音符鍵控制靜音。
 * The background music: one looping mp3, muted or unmuted by the note button beside the toolbar.
 *
 * 預設就該有聲，但瀏覽器只准「使用者手勢」之後才播放 —— 先試一次，被擋下就把第一次點擊／按鍵
 * 當成那個手勢再試，成功後立刻解綁。按下音符鍵本身不算手勢：那一下的意思通常是「靜音」，
 * 讓它順手把音樂播出來只會閃一下。
 * Sound is on by default, yet browsers only allow playback after a user gesture: try once up front,
 * and when that is blocked treat the first press or key as the gesture. The note button itself is
 * excluded — a press there normally means "mute", and starting playback on the way would only blip.
 */

import { i18n, t } from '../i18n';

/**
 * 預設音量。這是一首背景音樂，壓在音效之下而不是當主角。
 * The default volume: background music, sitting under the effects rather than in front of them.
 */
const DEFAULT_VOLUME = 0.4;

/**
 * 會被當成「手勢」的事件；`pointerdown` 涵蓋滑鼠與觸控，`keydown` 涵蓋鍵盤。
 * The events treated as a gesture: `pointerdown` covers mouse and touch, `keydown` the keyboard.
 */
const GESTURES = ['pointerdown', 'keydown'] as const;

export interface MusicToggleOptions {
  /**
   * 音符鍵（`layout.chrome.music`）。
   * The note button (`layout.chrome.music`).
   */
  button: HTMLButtonElement;
  /**
   * 音訊檔網址，已含 `BASE_URL`。
   * The audio file URL, already including `BASE_URL`.
   */
  src: string;
  /**
   * 音量 0–1；預設 0.4。
   * Volume 0–1; defaults to 0.4.
   */
  volume?: number;
}

export interface MusicToggle {
  /**
   * 現在是否靜音。預設不是。
   * Whether it is muted now; it starts unmuted.
   */
  readonly muted: boolean;
  setMuted(muted: boolean): void;
  dispose(): void;
}

/**
 * 建立音樂播放器並接管按鈕。
 * Builds the player and takes over the button.
 *
 * `aria-pressed` 代表「已靜音」：按下去就是按下靜音，而不是「音樂開著」。圖示的斜線與說明文字
 * 一起跟著同一個狀態走。
 * `aria-pressed` means "muted", so the button presses into mute rather than out of music; the
 * slash on the icon and the tooltip follow the same state.
 */
export function createMusicToggle(options: MusicToggleOptions): MusicToggle {
  const { button, src } = options;

  const audio = new Audio(src);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = options.volume ?? DEFAULT_VOLUME;

  let muted = false;

  function render(): void {
    button.setAttribute('aria-pressed', String(muted));
    button.classList.toggle('music--muted', muted);
    /*
     * 說明文字講「按下去會怎樣」，比單講狀態更清楚。它由這裡寫，而 `layout.ts` 刻意不掛
     * `data-i18n-title` —— 掛了就會在換語系時被 `applyTo()` 蓋回靜態的一句。
     * The tooltip states what a press will do rather than the state alone. It is written here,
     * and `layout.ts` deliberately leaves it untagged: a tag would let `applyTo()` reset it to a
     * static label on every locale change.
     */
    button.title = muted ? t('chrome.musicUnmute') : t('chrome.musicMute');
  }

  /** 手勢一到就解綁；播放成功才解，被擋下時留著等下一次。 */
  function detachGestures(): void {
    for (const type of GESTURES) document.removeEventListener(type, onGesture, true);
  }

  /**
   * 嘗試播放。被自動播放政策擋下時安靜收場 —— 畫面上沒有任何東西需要為此報錯。
   * Attempts playback. A blocked autoplay ends quietly: nothing on screen has to report it.
   */
  function attempt(): void {
    if (muted) return;

    void audio
      .play()
      .then(detachGestures)
      .catch((): void => {
        /* 等第一次手勢 / wait for the first gesture */
      });
  }

  function onGesture(event: Event): void {
    const target = event.target;
    /* 音符鍵的那一下留給它自己處理：見檔頭。 */
    /* The note button's own press is left to it: see the header. */
    if (target instanceof Node && button.contains(target)) return;
    attempt();
  }

  const onButtonClick = (): void => {
    muted = !muted;
    audio.muted = muted;
    render();
    /* 解除靜音時音樂可能從未開始（自動播放被擋、而玩家一直沒碰過畫面）。 */
    /* Unmuting may find the track never started: autoplay was blocked and the player never touched the page. */
    if (!muted) attempt();
  };

  render();
  for (const type of GESTURES) document.addEventListener(type, onGesture, true);
  attempt();

  button.addEventListener('click', onButtonClick);

  /* 換語系要重寫說明文字；按鈕的圖示與 `aria-pressed` 與語系無關。 */
  const unsubscribeLocale = i18n.subscribe(render);

  return {
    get muted(): boolean {
      return muted;
    },

    setMuted(next: boolean): void {
      if (next === muted) return;
      onButtonClick();
    },

    dispose(): void {
      unsubscribeLocale();
      detachGestures();
      button.removeEventListener('click', onButtonClick);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    },
  };
}
