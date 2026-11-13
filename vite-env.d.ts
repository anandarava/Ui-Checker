/// <reference types="vite/client" />

// CRXJS `?script` imports resolve to the built file name of a content script,
// usable with chrome.scripting.executeScript({ files: [name] }).
declare module "*?script" {
  const fileName: string;
  export default fileName;
}
declare module "*?script&iife" {
  const fileName: string;
  export default fileName;
}
