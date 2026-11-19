/*
   Copyright 2026 Shko Online LLC <sales@shko.online>

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
 */

/** Light or dark, as set on `<html data-ado-theme>` (see tab.css: the Storybook frame follows it). */
export type Scheme = 'light' | 'dark';

/** Relative luminance (0–1) of a computed `rgb()`/`rgba()` colour. */
export function luminance(color: string): number {
  const [r, g, b] = (color.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Marks the page light or dark (`<html data-ado-theme>`). The Storybook shown in the page's
 * frame then gets that as its preferred colour scheme, so a Storybook that follows the
 * preference (the default for Storybook's own interface) matches Azure DevOps.
 */
export function setScheme(scheme: Scheme | undefined): void {
  if (scheme) document.documentElement.dataset.adoTheme = scheme;
  else delete document.documentElement.dataset.adoTheme;
}

export function currentScheme(): Scheme | undefined {
  const scheme = document.documentElement.dataset.adoTheme;
  return scheme === 'light' || scheme === 'dark' ? scheme : undefined;
}

/**
 * Calls `listener` when the page's scheme changes (see {@link setScheme}), for example when
 * someone switches the theme of Azure DevOps. Returns a function that stops it.
 */
export function watchScheme(listener: (scheme: Scheme | undefined) => void): () => void {
  let last = currentScheme();
  const observer = new MutationObserver(() => {
    const next = currentScheme();
    if (next === last) return;
    last = next;
    listener(next);
  });
  observer.observe(document.documentElement, { attributeFilter: ['data-ado-theme'] });
  return () => observer.disconnect();
}
