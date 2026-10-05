/**
 * `poly-decomp` 的型別宣告。
 * Type declarations for `poly-decomp`.
 *
 * 套件本身以 CommonJS 發佈且沒有附型別，npm 上也沒有 `@types/poly-decomp`（已確認 404），
 * 所以這裡只宣告本專案實際用到的那一個成員：`decomp`，Matter 的 `Bodies.fromVertices`
 * 需要它來把凹多邊形切成凸塊。
 * The package ships CommonJS without types and there is no `@types/poly-decomp` on npm
 * (verified 404), so only the single member this project uses is declared: `decomp`, which
 * Matter's `Bodies.fromVertices` needs to cut concave polygons into convex pieces.
 *
 * 刻意**只宣告用到的部分**而不是整個 API：多餘的簽章若與套件實際行為不符，會變成假的保證。
 * Deliberately declares **only what is used** rather than the whole API: extra signatures that
 * drift from the package's real behaviour would be false assurance.
 *
 * 頂點以 `[x, y]` 陣列表示（poly-decomp 的既有慣例）。
 * Vertices are `[x, y]` tuples, matching poly-decomp's existing convention.
 */
declare module 'poly-decomp' {
  /** 多邊形：一連串 `[x, y]` 頂點。 */
  type Polygon = [number, number][];

  interface Decomp {
    /** 把凹多邊形分解成一或多個凸多邊形。 */
    decomp(polygon: Polygon): Polygon[];
    /** 快速分解（允許 Steiner 點）；比 `decomp` 快但結果可能更碎。 */
    quickDecomp(polygon: Polygon): Polygon[];
    /** 是否為簡單多邊形（邊不自交）。 */
    isSimple(polygon: Polygon): boolean;
    /** 移除共線點，回傳移除數量。 */
    removeCollinearPoints(polygon: Polygon, precision?: number): number;
    /** 把頂點順序改成逆時針；回傳是否有反轉。 */
    makeCCW(polygon: Polygon): boolean;
  }

  const decomp: Decomp;
  export default decomp;
}
