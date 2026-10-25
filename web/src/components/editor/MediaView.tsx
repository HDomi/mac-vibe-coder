import { api, type PreviewKind } from '../../lib/api';
import { t, useLang } from '../../lib/i18n';

interface Props { path: string; name: string; kind: PreviewKind; rev?: number }

/** Viewer for files the editor does not edit: images, video, audio, PDF and binaries. */
export default function MediaView({ path, name, kind, rev = 0 }: Props) {
  useLang();
  // `rev` busts the cache when the file changes on disk.
  const url = api.rawUrl(path) + (rev ? `&v=${rev}` : '');
  const dot = name.lastIndexOf('.');
  return (
    <div className="h-full overflow-auto">
      {kind === 'image' && (
        <div className="h-full flex items-center justify-center p-4">
          <img src={url} alt={name} className="max-w-full max-h-full object-contain rounded" />
        </div>
      )}
      {kind === 'video' && (
        <div className="h-full flex items-center justify-center p-4 bg-black">
          <video src={url} controls className="max-w-full max-h-full" />
        </div>
      )}
      {kind === 'audio' && (
        <div className="h-full flex items-center justify-center p-4">
          <audio src={url} controls className="w-full max-w-xl" />
        </div>
      )}
      {kind === 'pdf' && <iframe src={url} title={name} className="w-full h-full border-0 bg-white" />}
      {!['image', 'video', 'audio', 'pdf'].includes(kind) && (
        <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-sm gap-2">
          <div>{t('preview.noPreview')}</div>
          <div className="text-xs text-zinc-600">{dot > 0 ? name.slice(dot) : t('preview.noExt')}</div>
        </div>
      )}
    </div>
  );
}
