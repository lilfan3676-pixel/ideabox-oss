// 自己的模組用到的資料表放這裡（測試用的假資料庫會一起建立）。
type Row = Record<string, any>;
export const PRIVATE_DEFAULTS: Record<string, () => Row> = {};
export const PRIVATE_UNIQUE: Record<string, string[]> = {};
