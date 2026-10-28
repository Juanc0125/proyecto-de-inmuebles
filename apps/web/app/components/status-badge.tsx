import type { VideoStatus } from '@shared-types/video';
import { STATUS_BADGE_CLASSES, STATUS_DOT_CLASSES, STATUS_LABELS } from './constants';

// For tight spots (a poster corner on a phone): same colour, shorter word.
const SHORT_LABELS: Record<VideoStatus, string> = {
    borrador: 'Borrador',
    pendiente_aprobacion: 'Por aprobar',
    aprobado: 'Aprobado',
    publicado: 'Publicado',
};

export default function StatusBadge({ status, short = false }: { status: VideoStatus; short?: boolean }) {
    return (
        <span
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE_CLASSES[status]}`}
            title={short ? STATUS_LABELS[status] : undefined}
        >
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[status]}`} aria-hidden="true" />
            {short ? SHORT_LABELS[status] : STATUS_LABELS[status]}
        </span>
    );
}
