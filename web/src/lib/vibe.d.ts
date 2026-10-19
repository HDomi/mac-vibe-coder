export {};

declare global {
  interface Window {
    vibe?: {
      isElectron: boolean;
      pickFolder: () => Promise<string | null>;
      getPathForFile: (file: File) => string;
      loginItem: (enable: boolean | null) => Promise<boolean>;
    };
  }
}
