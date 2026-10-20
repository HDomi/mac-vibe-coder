export {};

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
      notify: (payload: { title: string; body: string; sessionId: string }) => void;
      onNotificationClick: (cb: (sessionId: string) => void) => void;
    };
  }
}
