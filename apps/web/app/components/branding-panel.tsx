'use client';

import { useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type { BrandTemplate } from '@shared-types/templates';
import type { LogoPosition } from '@shared-types/video';
import {
    applyBrandTemplate, deleteBrandTemplate, saveBrandTemplate,
    updateBranding, uploadLogo, type BrandingPatch, type VideoRecord,
} from './api';
import { FONT_OPTIONS, LOGO_POSITION_OPTIONS } from './constants';
import SectionIcon from './section-icon';

interface BrandingPanelProps {
    video: VideoRecord;
    onUpdated: (video: VideoRecord) => void;
    // Owned by the workspace, so a save that changes the brand mid-request
    // cannot lose the template it was creating.
    templates: BrandTemplate[];
    templatesLoading: boolean;
    templatesError: string;
    onTemplatesChanged: Dispatch<SetStateAction<BrandTemplate[]>>;
    onRetryTemplates: () => void;
}

// Only the fields the form copies into its own state. The logo is left out on
// purpose: it is shown straight from the record, and uploading one must not
// throw away colour or font edits that were not saved yet.
function brandSignature(branding: VideoRecord['branding']): string {
    const { primary_color, secondary_color, font_family, logo_position } = branding;
    return [primary_color, secondary_color, font_family, logo_position].join('|');
}

const ACCEPTED_LOGO_TYPES = 'image/png,image/jpeg,image/webp,image/svg+xml';

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        reader.readAsDataURL(file);
    });
}

export default function BrandingPanel({
    video, onUpdated, templates: brandTemplates, templatesLoading, templatesError, onTemplatesChanged, onRetryTemplates,
}: BrandingPanelProps) {
    const branding = video.branding;
    const [primaryColor, setPrimaryColor] = useState(branding.primary_color);
    const [secondaryColor, setSecondaryColor] = useState(branding.secondary_color);
    const [fontFamily, setFontFamily] = useState(branding.font_family);
    const [logoPosition, setLogoPosition] = useState<LogoPosition>(branding.logo_position);

    // The copilot can change this brand from outside. Instead of a key on the
    // whole panel (which would also wipe the template name, an in-flight save
    // and its error), only the form fields are reseeded when the stored brand
    // they copy actually changed - React's "adjust state on prop change"
    // pattern, done during render so the stale values never paint.
    const signature = brandSignature(branding);
    const [seededFrom, setSeededFrom] = useState(signature);
    if (seededFrom !== signature) {
        setSeededFrom(signature);
        setPrimaryColor(branding.primary_color);
        setSecondaryColor(branding.secondary_color);
        setFontFamily(branding.font_family);
        setLogoPosition(branding.logo_position);
    }
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [templateName, setTemplateName] = useState('');
    const [templateError, setTemplateError] = useState('');
    const [savingTemplate, setSavingTemplate] = useState(false);
    const [applyingId, setApplyingId] = useState<string | null>(null);
    const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

    const dirty =
        primaryColor !== branding.primary_color ||
        secondaryColor !== branding.secondary_color ||
        fontFamily !== branding.font_family ||
        logoPosition !== branding.logo_position;

    // Shared by the save button and by saving a template: a template captures
    // what is stored on the video, so pending edits have to land first or the
    // user would save a brand they cannot see.
    async function persistBranding() {
        const patch: BrandingPatch = {};
        if (primaryColor !== branding.primary_color) patch.primary_color = primaryColor;
        if (secondaryColor !== branding.secondary_color) patch.secondary_color = secondaryColor;
        if (fontFamily !== branding.font_family) patch.font_family = fontFamily;
        if (logoPosition !== branding.logo_position) patch.logo_position = logoPosition;
        if (Object.keys(patch).length === 0) return;

        const updated = await updateBranding(video.id, patch);
        onUpdated(updated);
    }

    async function handleSaveBranding() {
        if (!fontFamily.trim()) {
            setSaveError('La tipografía no puede quedar vacía.');
            return;
        }

        setSaving(true);
        setSaveError('');
        try {
            await persistBranding();
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'No se pudo guardar el branding.');
        } finally {
            setSaving(false);
        }
    }

    async function handleSaveTemplate() {
        const name = templateName.trim();
        if (!name) {
            setTemplateError('Ponle un nombre a la plantilla, por ejemplo "Marca principal".');
            return;
        }

        setSavingTemplate(true);
        setTemplateError('');
        try {
            await persistBranding();
            const created = await saveBrandTemplate(name, video.id);
            onTemplatesChanged((current) => [created, ...current.filter((item) => item.id !== created.id)]);
            setTemplateName('');
        } catch (err) {
            setTemplateError(err instanceof Error ? err.message : 'No se pudo guardar la plantilla de marca.');
        } finally {
            setSavingTemplate(false);
        }
    }

    async function handleApplyTemplate(template: BrandTemplate) {
        setApplyingId(template.id);
        setTemplateError('');
        try {
            const updated = await applyBrandTemplate(video.id, template.id);
            onUpdated(updated);
            // The form holds its own copy of each field, so it has to follow the
            // brand that was just applied instead of showing the previous one.
            setPrimaryColor(updated.branding.primary_color);
            setSecondaryColor(updated.branding.secondary_color);
            setFontFamily(updated.branding.font_family);
            setLogoPosition(updated.branding.logo_position);
        } catch (err) {
            setTemplateError(err instanceof Error ? err.message : 'No se pudo aplicar la plantilla de marca.');
        } finally {
            setApplyingId(null);
        }
    }

    async function handleDeleteTemplate(template: BrandTemplate) {
        const confirmed = window.confirm(`Se eliminará la plantilla de marca "${template.name}". ¿Continuar?`);
        if (!confirmed) return;

        setDeletingTemplateId(template.id);
        setTemplateError('');
        try {
            await deleteBrandTemplate(template.id);
            onTemplatesChanged((current) => current.filter((item) => item.id !== template.id));
        } catch (err) {
            setTemplateError(err instanceof Error ? err.message : 'No se pudo eliminar la plantilla de marca.');
        } finally {
            setDeletingTemplateId(null);
        }
    }

    async function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;

        setUploading(true);
        setUploadError('');
        try {
            const dataUrl = await readFileAsDataUrl(file);
            const result = await uploadLogo(video.id, dataUrl);
            onUpdated(result.video);
        } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'No se pudo subir el logo.');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }

    return (
        <section className="panel panel-pad">
            <div className="panel-head">
                <div className="panel-head-main">
                    <SectionIcon name="brand" />
                    <div className="min-w-0">
                        <h3 className="panel-title">Marca (branding)</h3>
                        <p className="hint">Colores, tipografía y logo que el video lleva en pantalla.</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                    <label className="label" htmlFor="primary-color">Color primario</label>
                    <div className="flex items-center gap-2">
                        <input
                            id="primary-color"
                            type="color"
                            value={primaryColor}
                            onChange={(event) => setPrimaryColor(event.target.value)}
                            disabled={saving}
                            className="h-10 w-14 cursor-pointer rounded-lg border border-white/20 bg-transparent p-1"
                        />
                        <span className="font-mono text-sm uppercase text-slate-300">{primaryColor}</span>
                    </div>
                </div>
                <div>
                    <label className="label" htmlFor="secondary-color">Color secundario</label>
                    <div className="flex items-center gap-2">
                        <input
                            id="secondary-color"
                            type="color"
                            value={secondaryColor}
                            onChange={(event) => setSecondaryColor(event.target.value)}
                            disabled={saving}
                            className="h-10 w-14 cursor-pointer rounded-lg border border-white/20 bg-transparent p-1"
                        />
                        <span className="font-mono text-sm uppercase text-slate-300">{secondaryColor}</span>
                    </div>
                </div>
                <div>
                    <label className="label" htmlFor="font-family">Tipografía</label>
                    {/* A select, not free text: only these four typefaces ship with the
                        renderer, and a name it cannot honour would silently do nothing. */}
                    <select
                        id="font-family"
                        value={FONT_OPTIONS.some((option) => option.value === fontFamily) ? fontFamily : 'sans'}
                        onChange={(event) => setFontFamily(event.target.value)}
                        disabled={saving}
                        className="field"
                    >
                        {FONT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="label" htmlFor="logo-position">Posición del logo</label>
                    <select
                        id="logo-position"
                        value={logoPosition}
                        onChange={(event) => setLogoPosition(event.target.value as LogoPosition)}
                        disabled={saving}
                        className="field"
                    >
                        {LOGO_POSITION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {saveError && <p className="alert alert-error mt-3" role="alert">{saveError}</p>}
            <div className="mt-3">
                <button
                    type="button"
                    onClick={handleSaveBranding}
                    disabled={saving || !dirty}
                    className="btn btn-primary"
                >
                    {saving && <span className="spinner" aria-hidden="true" />}
                    {saving ? 'Guardando...' : 'Guardar cambios de marca'}
                </button>
            </div>

            <div className="divider mt-6 pt-5">
                <label className="label" htmlFor="logo-upload">Logo</label>
                {branding.logo_url && (
                    // eslint-disable-next-line @next/next/no-img-element -- external/base64-derived Supabase Storage URL, not a static local asset.
                    <img src={branding.logo_url} alt="Logo actual de la marca" className="mb-3 h-16 w-auto rounded-lg border border-white/10 bg-white/5 object-contain p-1.5" />
                )}
                <input
                    id="logo-upload"
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_LOGO_TYPES}
                    onChange={handleLogoChange}
                    disabled={uploading}
                    className="file-input"
                />
                <p className="hint mt-1.5">PNG, JPG, WEBP o SVG. Máximo 2MB.</p>
                {uploading && (
                    <p className="mt-2 flex items-center gap-2 text-sm text-slate-300" role="status">
                        <span className="spinner text-brand-300" aria-hidden="true" />
                        Subiendo logo...
                    </p>
                )}
                {uploadError && <p className="alert alert-error mt-2" role="alert">{uploadError}</p>}
            </div>

            <div className="divider mt-6 pt-5">
                <h4 className="panel-title mb-1">Plantillas de marca</h4>
                <p className="panel-subtitle mb-4">
                    Guarda esta identidad (colores, tipografía, logo y su posición) con un nombre y aplícala a
                    cualquier otro video para producir contenido consistente sin repetir la configuración.
                </p>

                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="text"
                        value={templateName}
                        onChange={(event) => setTemplateName(event.target.value)}
                        placeholder="Ej. Marca principal"
                        maxLength={80}
                        disabled={savingTemplate}
                        aria-label="Nombre de la plantilla de marca"
                        className="field min-w-0 flex-1"
                    />
                    <button
                        type="button"
                        onClick={handleSaveTemplate}
                        disabled={savingTemplate || !templateName.trim()}
                        className="btn btn-secondary"
                    >
                        {savingTemplate && <span className="spinner" aria-hidden="true" />}
                        {savingTemplate ? 'Guardando...' : 'Guardar como plantilla'}
                    </button>
                </div>

                {templateError && <p className="alert alert-error mt-3" role="alert">{templateError}</p>}

                {templatesError && (
                    <div className="alert alert-error mt-3 flex flex-wrap items-center justify-between gap-2" role="alert">
                        <span className="min-w-0">{templatesError}</span>
                        <button type="button" onClick={onRetryTemplates} disabled={templatesLoading} className="btn btn-secondary btn-sm">
                            Reintentar
                        </button>
                    </div>
                )}

                {templatesLoading && brandTemplates.length === 0 ? (
                    <div className="mt-3 space-y-2" aria-hidden="true">
                        <div className="skeleton h-11 w-full rounded-xl" />
                    </div>
                ) : brandTemplates.length === 0 ? (
                    // Only when the list really loaded empty: after a failed
                    // load, "there are none" would be a claim we cannot make.
                    !templatesError && (
                        <p className="mt-4 rounded-xl border border-dashed border-white/[0.12] px-4 py-5 text-center text-sm text-slate-400">Todavía no hay plantillas de marca guardadas.</p>
                    )
                ) : (
                    <ul className="mt-3 space-y-2">
                        {brandTemplates.map((template) => (
                            <li key={template.id} className="tile flex items-center gap-2.5 px-3.5 py-2.5">
                                <span className="flex shrink-0 gap-1" aria-hidden="true">
                                    <span className="h-4 w-4 rounded-full border border-white/20" style={{ backgroundColor: template.branding.primary_color }} />
                                    <span className="h-4 w-4 rounded-full border border-white/20" style={{ backgroundColor: template.branding.secondary_color }} />
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm">{template.name}</span>
                                <button
                                    type="button"
                                    onClick={() => handleApplyTemplate(template)}
                                    disabled={applyingId === template.id}
                                    className="btn btn-primary btn-sm"
                                >
                                    {applyingId === template.id ? 'Aplicando...' : 'Aplicar'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDeleteTemplate(template)}
                                    disabled={deletingTemplateId === template.id}
                                    aria-label={`Eliminar la plantilla ${template.name}`}
                                    title="Eliminar plantilla"
                                    className="btn-icon btn-icon-danger"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
                                    </svg>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}
