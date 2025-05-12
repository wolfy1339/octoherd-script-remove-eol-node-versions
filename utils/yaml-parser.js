import { parseDocument } from 'yaml';

/**
 * @param {string} content
 * @param {number[]} nodeVersionsToRemove
 * @return {boolean}
 */
export function hasNodeVersionMatrixToRemove(content, nodeVersionsToRemove) {
  const yamlDocument = parseDocument(content);

  const jobs = yamlDocument.get('jobs');

  for (const { value: job } of jobs.items) {
    /** @type {import('../script.js').YAMLWorkflow} */
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

/**
 * @param {string} content
 * @param {number[]} nodeVersionsToRemove
 * @return {boolean}
 */
export function hasNodeVersionToRemove(content, nodeVersionsToRemove) {
  const yamlDocument = parseDocument(content);

  /** @type {import("yaml").YAMLMap<number, import('yaml').Pair<import('yaml').Scalar<string>, import('yaml').YAMLMap<import('yaml').Scalar<string>>>>} */
  const jobs = yamlDocument.get('jobs');

  for (const { value: job } of jobs.items) {
    const steps = job.get('steps');

    const nodeVersion = steps.items.find(step =>
      step?.get('uses') &&
      step?.get('uses').includes('actions/setup-node')
    )?.get('with').get('node-version');

    if (nodeVersion) {
      return nodeVersionsToRemove.includes(nodeVersion) || nodeVersionsToRemove.map(String).includes(nodeVersion);
    }
  }

  return false;
}
