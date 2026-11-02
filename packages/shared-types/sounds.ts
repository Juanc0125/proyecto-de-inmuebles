// RF-010: basic per-scene sound effects. Background music was removed from the
// product; see SoundKind for the leftover 'musica' value.
//
// A sound is referenced everywhere by one string so a video row only stores
// text: `biblioteca:<slug>` for the project's own generated library and
// `subido:<uuid>` for a file the business uploaded (the uuid is the row in
// `sound_assets` and also the storage file name).

// Only 'efecto' is offered or accepted. 'musica' stays in the union because
// rows uploaded before music was removed still carry it in `sound_assets`; the
// server filters them out of every listing and rejects new ones.
// @deprecated value: 'musica'.
export type SoundKind = 'musica' | 'efecto';
export type SoundOrigin = 'biblioteca' | 'subido';

export interface SoundAsset {
    id: string;            // 'biblioteca:calma' | 'subido:<uuid>'
    kind: SoundKind;
    name: string;          // what the person sees
    url: string;           // public, playable in <audio>
    origin: SoundOrigin;
    license: string;       // e.g. 'Propia del proyecto (CC0)' or what the uploader declared
    source: string | null; // origin URL (third-party CC0) or null
}

export const SOUND_BUCKET = 'sounds';

export interface SoundLibraryEntry {
    slug: string;
    kind: SoundKind;
    name: string;
    license: string;
    source: string | null;
}

const OWN_LICENSE = 'Propia del proyecto (CC0)';

// The slugs must match the files apps/render-worker/scripts/sound-library.mjs
// generates and uploads to `sounds/biblioteca/<slug>.m4a`. A third-party CC0
// track can be added here later, but only with a license and a source URL that
// a person has actually checked.
export const SOUND_LIBRARY: SoundLibraryEntry[] = [
    { slug: 'transicion', kind: 'efecto', name: 'Transición (barrido)', license: OWN_LICENSE, source: null },
    { slug: 'campana', kind: 'efecto', name: 'Campana', license: OWN_LICENSE, source: null },
    { slug: 'pop', kind: 'efecto', name: 'Pop', license: OWN_LICENSE, source: null },
    { slug: 'notificacion', kind: 'efecto', name: 'Notificación', license: OWN_LICENSE, source: null },
];

export const SOUND_SLUG_PATTERN = /^[a-z0-9-]+$/;
