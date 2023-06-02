import YAML from 'yaml';

const { parseDocument } = YAML;

/**
 * @param {string} content
 * @param {number[]} nodeVersionsToRemove
 * @return {boolean}
 */
export function hasNodeVersionToRemove(content, nodeVersionsToRemove) {
  const yamlDocument = parseDocument(
      Buffer.from(content, 'base64').toString('utf-8')
  );

  const jobs = yamlDocument.get('jobs');

  for (const { value: job } of jobs.items) {
    /** @type {import('../script').YAMLWorkflow} */
    const matrix = job
        .get('strategy')
        ?.get('matrix');

    const nodeVersions = matrix?.items.find(({ key }) => key.value === 'node' || key.value === 'node_version');

    if (nodeVersions) {
      for (const { value: nodeVersion } of nodeVersions.value.items) {
        if (nodeVersionsToRemove.includes(nodeVersion) || nodeVersionsToRemove.map(String).includes(nodeVersion)) {
          return true;
        }
      }
    }
  }

  return false;
}
