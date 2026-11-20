"use client";

import { useEffect, useState } from "react";
import { useL } from "../../LangProvider";
import { ASSISTANT_EVENT, readAssistantPrefs, saveAssistantPrefs, type AssistantSize } from "../WebAssistant";

/** 設定 → 外觀：右下角小助手要不要顯示、多大（記在這台瀏覽器；手機版沒有小助手，這塊不顯示） */
export function AssistantSettings() {
  const L = useL();
  const [prefs, setPrefs] = useState<{ hidden: boolean; size: AssistantSize }>({ hidden: false, size: "m" });
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    // 圖檔不在的話（例如公開版）小助手不會出現，設定也就不用顯示
    const img = new Image();
    img.onerror = () => setMissing(true);
    img.src = "/assistant/idle.png";
    const sync = () => setPrefs(readAssistantPrefs());
    sync();
    window.addEventListener(ASSISTANT_EVENT, sync);
    return () => window.removeEventListener(ASSISTANT_EVENT, sync);
  }, []);
  if (missing) return null;
  const sizes: [AssistantSize, string][] = [["s", L("小", "Small")], ["m", L("中", "Medium")], ["l", L("大", "Large")]];
  return (
    <div className="assistant-settings">
      <h4>{L("小助手", "Assistant")}</h4>
      <p className="muted small">{L("右下角的小人。點他一下就會告訴你現在最該看的事，再點一下關掉。", "The little character at the bottom right. Click it to hear what needs your attention; click again to close.")}</p>
      <div className="appearance">
        <div className="theme-switch inline" role="radiogroup" aria-label={L("要不要顯示小助手", "Show assistant")}>
          <button type="button" role="radio" aria-checked={!prefs.hidden} className={!prefs.hidden ? "active" : ""} onClick={() => saveAssistantPrefs({ hidden: false })}>{L("顯示", "Show")}</button>
          <button type="button" role="radio" aria-checked={prefs.hidden} className={prefs.hidden ? "active" : ""} onClick={() => saveAssistantPrefs({ hidden: true })}>{L("不顯示", "Hide")}</button>
        </div>
        <div className="theme-switch inline" role="radiogroup" aria-label={L("小助手大小", "Assistant size")}>
          {sizes.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={prefs.size === k} disabled={prefs.hidden} className={prefs.size === k ? "active" : ""} onClick={() => saveAssistantPrefs({ size: k })}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
