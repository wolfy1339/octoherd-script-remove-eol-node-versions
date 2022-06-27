import YAML from 'yaml';

const { parseDocument } = YAML;

/**
 * @param {string} content
 * @param {string[]} nodeVersionsToRemove
 *
 * @return {boolean}
 */
export function hasNodeVersionToRemove(content, nodeVersionsToRemove) {
  const yamlDocument = parseDocument(
      Buffer.from(content, 'base64').toString('utf-8')
  );

  const jobs = yamlDocument.get('jobs');

  for (const { value: job } of jobs.items) {
    const nodeVersions = job
        .get('strategy')
        ?.get('matrix')
        ?.get('node_version');

    if (nodeVersions) {
      for (const { value: nodeVersion } of nodeVersions.items) {
        if (nodeVersionsToRemove.include(nodeVersion)) {
          return true;
        }
      }
    }
  }

  return false;
}
