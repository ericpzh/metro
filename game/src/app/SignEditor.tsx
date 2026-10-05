// The 指示牌 board editor (§5.8). The implementation lives under `windows/sign/` — one
// unit per file: the modal shell owns the drag state, `tokens.ts` the pure layout model,
// `tileArt.tsx` the tile pictures, `palette.tsx` the group/option tiles, `BinStrip.tsx` a
// face's row of places, `TextFields.tsx` the 文字 boxes, `dragGhost.ts` the carried mark.
// This barrel keeps the app's import path stable.
export { SignEditor } from './windows/sign/SignEditor.tsx'
