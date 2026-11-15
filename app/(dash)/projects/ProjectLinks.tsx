"use client";

import { useL } from "@/app/LangProvider";
import { LINK_KINDS, LINK_LABEL, type LinkKind, type ProjectLinks as Links } from "@/lib/projectLogic";
import { IconChat, IconFacebook, IconGlobe, IconInstagram, IconPhone, IconThreads, IconYoutube } from "../icons";

const ICON: Record<LinkKind, (p: { size?: number }) => React.ReactNode> = {
  website: IconGlobe,
  instagram: IconInstagram,
  threads: IconThreads,
  facebook: IconFacebook,
  line: IconChat,
  youtube: IconYoutube,
  app: IconPhone,
};

/** 專案的官網、社群快捷圖示。有填的可以點開；沒填的淡淡的，點了打開設定去填（onEmpty） */
export function ProjectLinks({ links = {}, onEmpty, size = 16 }: { links?: Links; onEmpty?: () => void; size?: number }) {
  const L = useL();
  return (
    <div className="project-links">
      {LINK_KINDS.map((k) => {
        const Icon = ICON[k];
        const url = links[k];
        const label = L(...LINK_LABEL[k]);
        return url ? (
          <a key={k} href={url} target="_blank" rel="noopener noreferrer" className="project-link-btn" title={label} aria-label={label}>
            <Icon size={size} />
          </a>
        ) : (
          <button
            key={k}
            type="button"
            className="project-link-btn unset"
            title={onEmpty ? L(`還沒填${label}，點這裡去設定`, `No ${label} yet — click to add`) : L(`還沒填${label}（在專案卡片的設定裡加）`, `No ${label} yet (add it in the project card settings)`)}
            aria-label={L(`加上${label}`, `Add ${label}`)}
            onClick={onEmpty}
            disabled={!onEmpty}
          >
            <Icon size={size} />
          </button>
        );
      })}
    </div>
  );
}
