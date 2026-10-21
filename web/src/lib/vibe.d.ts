export {};

export interface NativeBrowserState { url: string; title: string; loading: boolean; canBack: boolean; canForward: boolean; zoom: number }
export interface ViewBounds { x: number; y: number; width: number; height: number }
export interface NativeBrowser {
  show: (bounds: ViewBounds) => Promise<NativeBrowserState>;
  setBounds: (bounds: ViewBounds) => Promise<void>;
  hide: () => Promise<void>;
  state: () => Promise<NativeBrowserState>;
  navigate: (url: string) => Promise<void>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  reload: () => Promise<void>;
  stop: () => Promise<void>;
  focus: () => Promise<void>;
  devtools: () => Promise<void>;
  zoom: (factor: number) => Promise<void>;
  capture: () => Promise<{ path: string; name: string }>;
  onState: (cb: (s: NativeBrowserState) => void) => () => void;
  onShortcut: (cb: (k: { key: string; shift: boolean; alt: boolean }) => void) => () => void;
}

declare global {
  interface Window {
    vibe?: {
      isElectron: boolean;
      pickFolder: () => Promise<string | null>;
      getPathForFile: (file: File) => string;
      loginItem: (enable: boolean | null) => Promise<boolean>;
      /** Tell the main process the current UI language (updates the Language menu checkmark). */
      setLanguage: (lang: string) => void;
      /** Receive language changes made from the macOS menu bar. */
      onLanguage: (cb: (lang: string) => void) => void;
      /** Show a native notification; the click handler receives the session id passed here. */
      notify: (payload: { title: string; body: string; sessionId: string; approval?: { requestId: string; canAlwaysAllow: boolean; labels: [string, string, string] } }) => void;
      onNotificationClick: (cb: (sessionId: string) => void) => void;
      /** Allow / always allow / deny chosen on an approval notification's buttons. */
      onNotificationApproval?: (cb: (answer: { sessionId: string; requestId: string; decision: 'allow' | 'allow_always' | 'deny' }) => void) => void;
      closeNotification?: (requestId: string) => void;
      openNotificationSettings?: () => void;
      /** Native browser view for the Browser panel (Electron only). */
      browser?: NativeBrowser;
    };
  }
}
