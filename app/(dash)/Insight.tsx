// 各頁共用的「重點數字卡」與右欄小面板（純顯示，沒有狀態）

/** 小走勢圖：填滿父層指定的大小，顏色跟著文字色 */
export function Spark({ data, className = "kpi-spark", fit = false }: { data: number[]; className?: string; fit?: boolean }) {
  if (data.length < 2) return null;
  // fit：照資料自己的最低到最高畫（股價這種不是從 0 開始的數字）；否則從 0 畫起（筆數）
  const min = fit ? Math.min(...data) : 0;
  const span = (fit ? Math.max(...data) - min : Math.max(...data, 1)) || 1;
  const step = 100 / (data.length - 1);
  // 上下各留一點空間，全部是 0 的時候畫在底部
  const pts = data.map((v, i) => `${(i * step).toFixed(1)} ${(36 - ((v - min) / span) * 30).toFixed(1)}`);
  return (
    <svg className={className} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      <path className="a" d={`M${pts.join("L")}V40H0Z`} />
      <path className="l" d={`M${pts.join("L")}`} />
    </svg>
  );
}

export function KpiRow({ children, label }: { children: React.ReactNode; label: string }) {
  return <section className="stats four kpi-row d-only" aria-label={label}>{children}</section>;
}

/** 一張數字卡：小標、大數字、一句說明，右下角可以帶走勢 */
export function Kpi({ label, value, hint, tone = "", pop = false, data }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "" | "warn" | "danger" | "ok"; pop?: boolean; data?: number[] }) {
  return (
    <div className={`glass stat kpi ${tone} ${pop ? "pop" : ""}`}>
      <span className="kpi-label">{label}</span>
      <b>{value}</b>
      <span className="kpi-hint">{hint ?? " "}</span>
      {data && <Spark data={data} />}
    </div>
  );
}

/** 跟上一期比的差距：+3／-2／持平 */
export function Delta({ now, prev, flat }: { now: number; prev: number; flat: string }) {
  const d = now - prev;
  if (!d) return <>{flat}</>;
  return <span className={d > 0 ? "delta-up" : "delta-down"}>{d > 0 ? `+${d}` : d}</span>;
}

export function SidePanel({ title, action, children, className = "" }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`glass panel side-panel ${className}`}>
      <div className="panel-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** 一列橫條：名稱、比例條、數字 */
export function BarRow({ label, n, max, color, wide = false }: { label: React.ReactNode; n: number; max: number; color?: string; wide?: boolean }) {
  return (
    <div className={`bar-row ${wide ? "wide" : ""}`}>
      <span className="bar-label">{label}</span>
      <span className="bar-track" aria-hidden><i style={{ width: `${max ? Math.round((n / max) * 100) : 0}%`, background: color }} /></span>
      <span className="bar-n">{n}</span>
    </div>
  );
}

/** 每週長條：由舊到新，最後一條（這週）用強調色 */
export function WeekBars({ data, label }: { data: number[]; label: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="week-bars" role="img" aria-label={label}>
      {data.map((n, i) => (
        <i key={i} className={i === data.length - 1 ? "now" : ""} style={{ height: `${Math.max(4, Math.round((n / max) * 100))}%` }} title={String(n)} />
      ))}
    </div>
  );
}
