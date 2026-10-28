// RF-028: saved brand identities that can be applied to any video.
//
// The same shape as video-persistence: Supabase through the service role, with
// an in-memory fallback so the studio keeps working when the database is not
// configured. A brand template that vanishes on restart is still better than a
// panel that errors out.

import type { BrandTemplate } from '@shared-types/templates';
import type { Branding } from '@shared-types/video';
import { DEFAULT_BRANDING } from '@shared-types/video';
import { getSupabaseClient, supabaseUrl } from './supabaseClient';
import { ensureDemoUser } from './video-persistence';

type DatabaseRow = Record<string, unknown>;

const mockTemplates = new Map<string, BrandTemplate>();

export const LOGO_BUCKET = 'branding-logos';

// The render worker downloads logo_url server side, so a URL taken from a
// client would let anyone make it fetch an arbitrary address (SSRF). Only a
// file in this project's public logo bucket - what /api/videos/[id]/logo
// stores - is accepted; anything else becomes "no logo". Parsed with URL so a
// "../" or a look-alike host cannot slip past a plain prefix check.
export function safeLogoUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value || !supabaseUrl) return null;
    try {
        const base = new URL(supabaseUrl);
        const url = new URL(value);
        const prefix = `${base.pathname.replace(/\/+$/, '')}/storage/v1/object/public/${LOGO_BUCKET}/`;
        if (url.protocol !== base.protocol || url.host !== base.host) return null;
        if (url.username || url.password) return null;
        if (!url.pathname.startsWith(prefix) || url.pathname.length === prefix.length) return null;
        if (/%2e|%2f|%5c/i.test(url.pathname)) return null;
        return value.startsWith(`${base.origin}${prefix}`) ? value : null;
    } catch {
        return null;
    }
}

function toBranding(value: unknown): Branding {
    if (!value || typeof value !== 'object') return { ...DEFAULT_BRANDING };
    const source = value as Record<string, unknown>;
    return {
        logo_url: typeof source.logo_url === 'string' ? source.logo_url : null,
        logo_position: (typeof source.logo_position === 'string' ? source.logo_position : DEFAULT_BRANDING.logo_position) as Branding['logo_position'],
        primary_color: typeof source.primary_color === 'string' ? source.primary_color : DEFAULT_BRANDING.primary_color,
        secondary_color: typeof source.secondary_color === 'string' ? source.secondary_color : DEFAULT_BRANDING.secondary_color,
        font_family: typeof source.font_family === 'string' ? source.font_family : DEFAULT_BRANDING.font_family,
    };
}

function toBrandTemplate(row: DatabaseRow): BrandTemplate {
    return {
        id: String(row.id),
        name: String(row.name ?? 'Sin nombre'),
        branding: toBranding(row.branding),
        created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    };
}

function sortNewestFirst(templates: BrandTemplate[]): BrandTemplate[] {
    return [...templates].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function listBrandTemplates(): Promise<BrandTemplate[]> {
    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (client) {
        try {
            const { data, error } = await client.from('brand_templates').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            return (data ?? []).map(toBrandTemplate);
        } catch (error) {
            console.warn('Fallo al listar plantillas de marca en Supabase, usando fallback en memoria.', error);
        }
    }
    return sortNewestFirst([...mockTemplates.values()]);
}

export async function getBrandTemplate(id: string): Promise<BrandTemplate | null> {
    const client = getSupabaseClient({ serviceRole: true }) ?? getSupabaseClient();
    if (client) {
        try {
            const { data, error } = await client.from('brand_templates').select('*').eq('id', id).maybeSingle();
            if (error) throw error;
            if (data) return toBrandTemplate(data);
        } catch (error) {
            console.warn('Fallo al leer la plantilla de marca en Supabase, usando fallback en memoria.', error);
        }
    }
    return mockTemplates.get(id) ?? null;
}

export async function createBrandTemplate(name: string, branding: Branding): Promise<BrandTemplate> {
    const client = getSupabaseClient({ serviceRole: true });
    if (client) {
        try {
            const userId = await ensureDemoUser();
            if (!userId) throw new Error('No fue posible preparar el usuario demo para Supabase.');
            const { data, error } = await client
                .from('brand_templates')
                .insert({ user_id: userId, name, branding })
                .select()
                .single();
            if (error || !data) throw error ?? new Error('No se pudo guardar la plantilla de marca.');
            return toBrandTemplate(data);
        } catch (error) {
            console.warn('Fallo al guardar la plantilla de marca en Supabase, usando fallback en memoria.', error);
        }
    }

    const template: BrandTemplate = {
        id: crypto.randomUUID(),
        name,
        branding: { ...branding },
        created_at: new Date().toISOString(),
    };
    mockTemplates.set(template.id, template);
    return template;
}

export async function deleteBrandTemplate(id: string): Promise<boolean> {
    const client = getSupabaseClient({ serviceRole: true });
    if (client) {
        try {
            const { data, error } = await client.from('brand_templates').delete().eq('id', id).select('id');
            if (error) throw error;
            if ((data ?? []).length > 0) return true;
        } catch (error) {
            console.warn('Fallo al eliminar la plantilla de marca en Supabase, usando fallback en memoria.', error);
        }
    }
    return mockTemplates.delete(id);
}
