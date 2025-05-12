// @ts-check
import { composeCreatePullRequest } from 'octokit-plugin-create-pull-request';
import prettier from 'prettier';
import { hasNodeVersionMatrixToRemove, hasNodeVersionToRemove } from './utils/yaml-parser.js';
import { parseDocument, stringify } from 'yaml';

const PATH = '.github/workflows';
const NODE_VERSIONS_TO_REMOVE = [18];
const NODE_VERSIONS = [20, 22, 24];
const NODE_VERSIONS_STRING = NODE_VERSIONS_TO_REMOVE.map(e => `v${e}`).join(', ');

/**
 * @typedef {object} Response
 * @property {boolean} updated
 * @property {boolean} deleted
 * @property {string} content
 */

/**
 * @typedef {import('yaml').YAMLMap<YAMLStringScalar, import('yaml').YAMLMap<YAMLStringScalar, import('yaml').YAMLMap<YAMLStringScalar, YAMLNodeVersionMap>>>} YAMLWorkflow
 */

/**
 * @typedef {import('yaml').Scalar<string>} YAMLStringScalar
 */
/**
 * @typedef {import('yaml').YAMLMap<import('yaml').Scalar<'node' | 'node_version'>, YAMLNumberSequence>} YAMLNodeVersionMap
 */

/**
 * @typedef {import('yaml').YAMLSeq<import('yaml').Scalar<number>>} YAMLNumberSequence
 */

/**
 * Check if a filename is a YAML file
 * @param {string} fileName FileName to be tested
 * @return {boolean}
 */
const isYamlFile = fileName => /\.ya?ml$/.test(fileName);


/**
 * An octoherd script to remove EOL NodeJS versions from @octokit repositories
 * @param {import('@octoherd/cli').Octokit} octokit
 * @param {import('@octoherd/cli').Repository} repository
 * @param {object} options
 * @param {boolean} [options.update=false] When set to `true`, the script will update the versions without a breaking change
 */
export async function script(octokit, repository, { update=false }) {
  if (repository.archived) {
    octokit.log.info(`${repository.html_url} is archived, ignoring.`);

    return;
  }

  // Global variables used throughout the code
  const owner = repository.owner.login;
  const repo = repository.name;
  const branchName = 'remove-eol-node-versions';
  /** @type {import('octokit-plugin-create-pull-request').createPullRequest.Changes[]} */
  const changes = [];

  if (!update) {
    changes.push(...[{
      files: {
        'package.json': async ({ exists, encoding, content }) => {
          if (!exists) return null;

          const pkg = JSON.parse(Buffer.from(content, encoding).toString('utf-8'));

          pkg.engines ??= {};
          pkg.engines.node = `>= ${NODE_VERSIONS[0]}`;

          return await prettier.format(JSON.stringify(pkg), { parser: 'json-stringify' });
        }
      },
      commit: `build(package): set minimal node version in engines field to v${NODE_VERSIONS[0]}
BREAKING CHANGE: Drop support for NodeJS ${NODE_VERSIONS_STRING}`,
      emptyCommit: false
    },
    {
      files: {
        'scripts/build.mjs': async ({ exists, encoding, content }) => {
          if (!exists) return null;

          return await prettier.format(Buffer.from(content, encoding)
              .toString('utf-8')
              .replace(
                  new RegExp(`node${NODE_VERSIONS_TO_REMOVE.join('|')}`, 'g'),
                  `node${NODE_VERSIONS[0]}`
              ),
          { parser: 'babel' }
          );
        }
      },
      commit: `build: set minimal node version in build script to v${NODE_VERSIONS[0]}`

    }
    ]);
  }

  /**
   * @param {Exclude<import('@octokit/openapi-types').components["schemas"]["content-tree"]['entries'], undefined>[number] | import('@octokit/openapi-types').components["schemas"]["content-tree"]} file
   * @param {import('octokit-plugin-create-pull-request').createPullRequest.UpdateFunctionFile} options
   * @return {Promise<string | null>}
   */
  async function updateYamlFile(file, { content, encoding, exists }) {
    if (!exists) return null;

    octokit.log.info('Checking \'%s\' in \'%s\' repo', file.name, repo);

    const stringContent = Buffer.from(content, encoding).toString('utf-8');

    const hasNodeVersionMatrixJob = hasNodeVersionMatrixToRemove(stringContent, NODE_VERSIONS_TO_REMOVE);
    const hasNodeVersion = hasNodeVersionToRemove(stringContent, NODE_VERSIONS_TO_REMOVE);

    if (!update) {
      if (!hasNodeVersionMatrixJob && !hasNodeVersion) {
        octokit.log.info(
            'The file \'%s\' does not have any usage of node_version %s to be removed. Skipping...',
            file.name,
            `${NODE_VERSIONS_TO_REMOVE}`
        );

        return null;
      }
      octokit.log.warn(
          'The repository \'%s\' has a node_version %s to be removed in its GitHub Actions.\n %s',
          repo,
          `${NODE_VERSIONS_TO_REMOVE}`,
          repository.html_url
      );
    } else {
      octokit.log.info(
          'Updating the file \'%s\' to use node_version %s to be in its GitHub Actions',
          file.path,
          `${NODE_VERSIONS}`
      );
    }

    // Update Node versions used in GitHub Actions
    const yamlDocument = parseDocument(stringContent);

    /** @type {import("./types.js").JobsMap} */
    // @ts-expect-error
    const jobs = yamlDocument.get('jobs');
    let hasNodeVersionsMatrix = false;

    if (hasNodeVersionMatrixJob) {
      for (const { value: job, key: jobName } of jobs.items) {
        /** @type {import('./types.js').MatrixMap} */
        const matrix = job
            ?.get('strategy')
            ?.get('matrix');

        const nodeVersions = matrix?.items.find(({ key }) => key.value === 'node' || key.value === 'node_version');

        if (typeof nodeVersions === 'undefined') {
          continue;
        }
        hasNodeVersionsMatrix = true;
        yamlDocument.setIn(['jobs', jobName, 'strategy', 'matrix', nodeVersions.key.value], NODE_VERSIONS);
      }

      if (!hasNodeVersionsMatrix) {
        octokit.log.info('No node_version matrix found in %s', file.name);

        return null;
      }
    }
    if (hasNodeVersion) {
      for (const { value: job, key: jobName } of jobs.items) {
        /** @type {import("yaml").YAMLSeq<import("./types.js").StepDefinition>} */
        const steps = job?.get('steps');

        const nodeVersion = steps?.items?.find(step =>
          step?.get('uses') &&
          step?.get('uses').includes('actions/setup-node')
        );

        if (nodeVersion) {
          yamlDocument.setIn(['jobs', jobName, 'steps', nodeVersion.key, 'with', 'node-version'], NODE_VERSIONS.at(-1));
        }
      }
    }

    return await prettier.format(stringify(yamlDocument), { parser: 'yaml' });
  }

  /** @type {Exclude<import('@octokit/openapi-types').components["schemas"]["content-tree"]['entries'], undefined> | [import('@octokit/openapi-types').components["schemas"]["content-tree"]]} */
  let files;

  // Get all files from .github/workflows folder
  try {
    /** @type {import('@octokit/types').OctokitResponse<import('@octokit/openapi-types').components["schemas"]["content-tree"]>} */
    // @ts-ignore Overriding the type of the response for the correct type with the `object` media type
    const { data } = await octokit.request(
        'GET /repos/{owner}/{repo}/contents/{path}',
        {
          owner,
          repo,
          path: PATH,
          mediaType: {
            format: 'object'
          }
        }
    );

    // We know that the path is a directory, we do this check to appease typescript and get rid of the `undefined`
    if (data.entries) {
      files = data.entries.filter(entry => isYamlFile(entry.name))
          .filter(entry => !['add_to_octokit_project.yml', 'immediate-response.yml', 'codeql.yml'].includes(entry.name));
    } else {
      files = [data];
    }
  } catch (e) {
    if (e.status === 404) {
      octokit.log.warn(`"${PATH}" path not found in ${repository.full_name}`);

      return null;
    }
    throw e;
  }

  if (files.length) {
    for (const file of files) {
      changes.push({
        files: {
          [`.github/workflows/${file.name}`]: updateYamlFile.bind(null, file)
        },
        commit: update ? `ci: start testing against ${NODE_VERSIONS.at(-1)}` :
          `ci: stop testing against NodeJS ${NODE_VERSIONS_STRING}`,
        emptyCommit: false
      });
    }
  } else {
    octokit.log.info('There is no file %s in repository %s', PATH, repo);
  }

  //
  // Pull Request
  //

  const pr = await composeCreatePullRequest(octokit, {
    owner,
    repo,
    title: update ? `ci: start testing against NodeJS ${NODE_VERSIONS.at(-1)}` :
      `ci: stop testing against NodeJS ${NODE_VERSIONS_STRING}`,
    body: update ? `Adds Node ${NODE_VERSIONS.at(-1)} to the node_versions matrix` :
      `BREAKING CHANGE: Drop support for NodeJS ${NODE_VERSIONS_STRING}`,
    head: branchName,
    changes,
    createWhenEmpty: false,
    update: true,
    labels: update ? ['Type: Maintenance'] : ['Type: Maintenance', 'Type: Breaking Change'],
    draft: true
  });


  if (pr) {
    const { data: { html_url } } = pr;

    octokit.log.info(`Pull request created: ${html_url}`);
  }
}
