/** Version of the scan engine, written into every result so saved scans can be told apart. */
export const ENGINE_VERSION = "0.4.0";

/** Marker the content script sets on `window` once loaded, so it is injected only once per frame. */
export const LOADED_FLAG = "__uiConsistencyCheckerLoaded";

/** Attribute on every element the extension adds to a page; the scan skips anything carrying it. */
export const OWN_UI_ATTR = "data-ui-consistency-checker";

/** Id of the element that holds everything the extension draws on a page. */
export const OVERLAY_HOST_ID = "ui-consistency-checker-overlay";

/** chrome.storage keys. */
export const STORAGE_SETTINGS = "settings";
export const STORAGE_RESULT_PREFIX = "result:";
