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

/*
    "Built for free by Shko Online" link and the details dialog it opens.
    Deliberately low-key: a muted link in the toolbar; the dialog only opens on click.
*/
import { PRODUCT_NAME } from '../shared/product';

const SITE = 'https://shko.online';
const CAMPAIGN = 'utm_source=azure-devops&utm_medium=extension&utm_campaign=storybook-ado-pane';
const EMAIL = 'sales@shko.online';
const SOURCE = 'https://github.com/Shko-Online/storybook-ado-pane';

let dialog: HTMLDialogElement | undefined;

/** Creates the toolbar link. The dialog is built on first click. */
export function createUpsellLink(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sbp-upsell-link';
  button.textContent = 'Built for free by Shko Online';
  button.setAttribute('aria-haspopup', 'dialog');
  button.addEventListener('click', () => {
    const d = (dialog ??= buildDialog());
    d.showModal();
  });
  return button;
}

function buildDialog(): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.className = 'sbp-upsell';
  d.setAttribute('aria-labelledby', 'sbp-upsell-title');
  // Content lives in an inner box so a click on the <dialog> element itself means "backdrop".
  d.innerHTML = `<div class="sbp-upsell-body">
    <form method="dialog" class="sbp-upsell-close-form">
      <button class="sbp-upsell-close" aria-label="Close">×</button>
    </form>
    <h2 id="sbp-upsell-title">Built for free by Shko Online</h2>
    <p>
      ${PRODUCT_NAME} is a free, open-source extension from <strong>Shko Online</strong>, a Microsoft
      Business Applications consultancy in Tirana, Albania, and a Microsoft Partner Network member.
    </p>
    <p>We can help your team with:</p>
    <ul>
      <li><strong>Azure DevOps extensions, pipelines and test automation</strong>, like this one.</li>
      <li><strong>Dynamics 365, Power Platform and Azure projects</strong>, delivered end to end or with our consultants joining your team.</li>
      <li><strong>Bespoke Power Platform tools and PCF components</strong> for Dataverse teams.</li>
    </ul>
    <p>
      Need a feature in this extension, or help with your next project? Tell us about your goals
      and we will shape the right solution with you.
    </p>
    <div class="sbp-upsell-actions">
      <a class="sbp-button sbp-button-primary" href="${SITE}/contact-us?${CAMPAIGN}" target="_blank" rel="noopener">Book a consultation</a>
      <a class="sbp-button" href="${SITE}/consulting?${CAMPAIGN}" target="_blank" rel="noopener">How we work</a>
    </div>
    <p class="sbp-upsell-fine">
      Or write to <a href="mailto:${EMAIL}?subject=${encodeURIComponent(PRODUCT_NAME)}">${EMAIL}</a>.
      The extension stays free either way.
    </p>
    <p class="sbp-upsell-fine sbp-upsell-legal">
      Licensed under the Apache License, Version 2.0.
      <a href="${SOURCE}" target="_blank" rel="noopener">Source code on GitHub</a>.
      Storybook is a trademark of its respective owners; this extension is an independent project.
    </p></div>`;
  // Click on the backdrop closes the dialog.
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.body.appendChild(d);
  return d;
}
