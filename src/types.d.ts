declare module 'file-saver';

declare interface ImportMetaEnv {
  readonly BASE_URL: string;
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}
