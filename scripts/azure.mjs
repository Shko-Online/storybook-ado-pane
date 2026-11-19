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

// Signing in to Azure DevOps and the Marketplace from the maintainers' scripts: your own
// Azure CLI login (`az login`), no personal access token.
import { execFileSync } from 'node:child_process';

/** Application id of Azure DevOps, which the Marketplace belongs to. */
const AZURE_DEVOPS_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';

/** An access token for the Azure DevOps and Marketplace REST APIs, as the signed-in Azure CLI user. */
export function accessToken() {
  try {
    const token = execFileSync(
      'az',
      ['account', 'get-access-token', '--resource', AZURE_DEVOPS_RESOURCE, '--query', 'accessToken', '-o', 'tsv'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    if (!token) throw new Error('empty token');
    return token;
  } catch (err) {
    throw new Error(`Could not get an access token from the Azure CLI. Run \`az login\` first. (${String(err.message).split('\n')[0]})`);
  }
}
