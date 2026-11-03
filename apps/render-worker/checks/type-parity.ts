// Proves the worker's domain types still match packages/shared-types.
//
// The worker cannot simply import them. Pulling a .ts file from another package
// into this program makes tsc emit JavaScript for it and moves the entry point:
// `dist/index.js`, which is what Railway starts, becomes
// `dist/apps/render-worker/index.js`. The alternative - a build step that emits
// declarations for shared-types - is a deploy change, not a type change.
//
// So the duplication stays and the drift is caught here instead. This file is
// outside the build's `include`, so it never reaches dist; it is compiled by
// `npm run check:types` (tsconfig.check.json, noEmit) and fails the build the
// day either side changes without the other.

import type { CharacterType as WorkerCharacter, SceneAction as WorkerAction, ScenePropType as WorkerProp, VisualStyle as WorkerVisualStyle } from '../drawing';
import type { Branding as WorkerBranding, LogoPosition as WorkerLogoPosition, Platform as WorkerPlatform } from '../index';
import type {
	Branding as SharedBranding,
	CharacterType as SharedCharacter,
	LogoPosition as SharedLogoPosition,
	Platform as SharedPlatform,
	SceneAction as SharedAction,
	ScenePropType as SharedProp,
	VisualStyle as SharedVisualStyle,
} from '../../../packages/shared-types/video';

// Mutual assignability, not one-way: a worker type missing a value the web app
// can store is just as broken as the reverse. The tuples stop a union from
// being distributed over the conditional.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function sonIguales<T extends true>(): void;

sonIguales<Exact<WorkerCharacter, SharedCharacter>>();
sonIguales<Exact<WorkerAction, SharedAction>>();
sonIguales<Exact<WorkerProp, SharedProp>>();
sonIguales<Exact<WorkerPlatform, SharedPlatform>>();
sonIguales<Exact<WorkerLogoPosition, SharedLogoPosition>>();
sonIguales<Exact<WorkerBranding, SharedBranding>>();
sonIguales<Exact<WorkerVisualStyle, SharedVisualStyle>>();
