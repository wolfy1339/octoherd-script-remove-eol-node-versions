import { parseDocument } from 'yaml';

/**
 * @param {string} content
 * @param {number[]} nodeVersionsToRemove
 * @return {boolean}
 */
export function hasNodeVersionToRemove(content, nodeVersionsToRemove) {
  const yamlDocument = parseDocument(content);

  const jobs = yamlDocument.get('jobs');

  for (const { value: job } of jobs.items) {
    /** @type {import('../script').YAMLWorkflow} */
    const matrix = job
        .get('strategy')
        ?.get('matrix');

    const nodeVersions = matrix?.items.find(({ key }) => key.value === 'node' || key.value === 'node_version');

    if (nodeVersions) {
      return nodeVersions.value.items.some(
          ({ value: nodeVersion }) => nodeVersionsToRemove.includes(nodeVersion) ||
          nodeVersionsToRemove.map(String).includes(nodeVersion)
      );
    }
  }

  return false;
}
